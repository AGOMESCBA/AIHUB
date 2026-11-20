from pathlib import Path
root=Path('C:/Apps/ELOGESTAO')
files={
'apps/api/app/services/contract_finance.py':r'''"""Cálculos puros da fundação 4B/4C; ainda sem rotas ou efeito em saldos persistidos.

Valores em centavos inteiros, compatíveis com bigint. Empenhar reserva o limite
contratual; realizar consome a reserva já existente, sem reservar novamente.
Os serviços deverão carregar os totais sob bloqueio, conferir autorização,
alçada, estado e vigência e gravar origem/auditoria na mesma transação.
Este módulo não aprova atos, não fornece autorização e não consulta o banco.
"""
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext


MAX_CENTS = 2**63 - 1


class FinancialRuleError(ValueError):
    """Erro de domínio; o adaptador HTTP deverá traduzi-lo para problem+json."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def cents(value: int, *, positive: bool = False) -> int:
    if type(value) is not int or value < (1 if positive else 0) or value > MAX_CENTS:
        raise FinancialRuleError('INVALID_MONEY')
    return value


def item_total(quantity: str, unit_price_cents: int) -> int:
    """Quantidade decimal textual (até seis casas); arredonda uma vez por item.

    Float é recusado: os adaptadores precisam preservar o decimal do contrato.
    A política de precisão deve ser reaplicada ao snapshot do item na persistência.
    """
    cents(unit_price_cents, positive=True)
    if not isinstance(quantity, str) or not quantity or len(quantity) > 40:
        raise FinancialRuleError('INVALID_QUANTITY')
    try:
        q = Decimal(quantity)
    except InvalidOperation as error:
        raise FinancialRuleError('INVALID_QUANTITY') from error
    if not q.is_finite() or q <= 0 or q > Decimal('999999999999') or q.as_tuple().exponent < -6:
        raise FinancialRuleError('INVALID_QUANTITY')
    with localcontext() as ctx:
        ctx.prec = 50
        value = int((q * unit_price_cents).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    return cents(value, positive=True)


@dataclass(frozen=True)
class CommitmentPosition:
    approved_cents: int
    realized_cents: int = 0

    def __post_init__(self):
        cents(self.approved_cents)
        cents(self.realized_cents)
        if self.realized_cents > self.approved_cents:
            raise FinancialRuleError('COMMITMENT_EXCEEDED')

    @property
    def available_cents(self) -> int:
        return self.approved_cents - self.realized_cents


@dataclass(frozen=True)
class ContractPosition:
    limit_cents: int
    committed_cents: int = 0
    realized_cents: int = 0

    def __post_init__(self):
        for value in (self.limit_cents, self.committed_cents, self.realized_cents):
            cents(value)
        if not self.realized_cents <= self.committed_cents <= self.limit_cents:
            raise FinancialRuleError('CONTRACT_LIMIT_EXCEEDED')

    @property
    def available_to_commit_cents(self) -> int:
        return self.limit_cents - self.committed_cents

    @property
    def committed_to_realize_cents(self) -> int:
        return self.committed_cents - self.realized_cents

    def reserve(self, amount: int) -> 'ContractPosition':
        cents(amount, positive=True)
        if amount > self.available_to_commit_cents:
            raise FinancialRuleError('INSUFFICIENT_CONTRACT_BALANCE')
        return replace(self, committed_cents=self.committed_cents + amount)

    def realize(self, commitment: CommitmentPosition, amount: int) -> tuple['ContractPosition', CommitmentPosition]:
        cents(amount, positive=True)
        self._contains(commitment)
        if amount > commitment.available_cents:
            raise FinancialRuleError('INSUFFICIENT_COMMITMENT_BALANCE')
        return (replace(self, realized_cents=self.realized_cents + amount),
                replace(commitment, realized_cents=commitment.realized_cents + amount))

    def reverse_realization(self, commitment: CommitmentPosition, amount: int
                            ) -> tuple['ContractPosition', CommitmentPosition]:
        """Cálculo compensatório; origem única e limite do estorno são dever do serviço transacional."""
        cents(amount, positive=True)
        self._contains(commitment)
        if amount > commitment.realized_cents:
            raise FinancialRuleError('REVERSAL_EXCEEDS_REALIZED')
        return (replace(self, realized_cents=self.realized_cents - amount),
                replace(commitment, realized_cents=commitment.realized_cents - amount))

    def release(self, commitment: CommitmentPosition, amount: int
                ) -> tuple['ContractPosition', CommitmentPosition]:
        """Libera somente a parcela ainda não realizada de um empenho."""
        cents(amount, positive=True)
        self._contains(commitment)
        if amount > commitment.available_cents:
            raise FinancialRuleError('RELEASE_EXCEEDS_AVAILABLE')
        return (replace(self, committed_cents=self.committed_cents - amount),
                replace(commitment, approved_cents=commitment.approved_cents - amount))

    def with_amended_limit(self, new_limit_cents: int) -> 'ContractPosition':
        """Após aprovação do aditivo; aumentar limite não cria empenho nem realização."""
        return replace(self, limit_cents=cents(new_limit_cents))

    def _contains(self, commitment: CommitmentPosition) -> None:
        # A identidade do contrato do empenho é validada pela FK e pelo serviço.
        if (commitment.approved_cents > self.committed_cents
                or commitment.realized_cents > self.realized_cents
                or commitment.available_cents > self.committed_to_realize_cents):
            raise FinancialRuleError('INCONSISTENT_FINANCIAL_POSITION')
''',
'apps/api/tests/test_contract_finance.py':r'''"""Amostra financeira pura: nenhum banco ou acesso operacional é alterado."""
import pytest

from app.services.contract_finance import (
    MAX_CENTS, CommitmentPosition, ContractPosition, FinancialRuleError, cents, item_total,
)


def test_commitment_and_measurement_do_not_deduct_contract_twice():
    initial = ContractPosition(100_000)
    reserved = initial.reserve(80_000)
    used, commitment = reserved.realize(CommitmentPosition(80_000), 30_000)
    assert initial.committed_cents == 0
    assert (used.available_to_commit_cents, used.committed_to_realize_cents,
            used.realized_cents, commitment.available_cents) == (20_000, 50_000, 30_000, 50_000)


def test_multiple_commitments_and_full_consumption_preserve_global_limit():
    p = ContractPosition(100_000).reserve(60_000).reserve(40_000)
    p, a = p.realize(CommitmentPosition(60_000), 60_000)
    p, b = p.realize(CommitmentPosition(40_000), 40_000)
    assert (p.available_to_commit_cents, p.committed_to_realize_cents, p.realized_cents) == (0, 0, 100_000)
    assert a.available_cents == b.available_cents == 0
    with pytest.raises(FinancialRuleError, match='INSUFFICIENT_CONTRACT_BALANCE'):
        p.reserve(1)
    with pytest.raises(FinancialRuleError, match='INSUFFICIENT_COMMITMENT_BALANCE'):
        p.realize(a, 1)


def test_measurement_reversal_and_release_affect_separate_balances():
    p = ContractPosition(100_000, 80_000, 30_000)
    e = CommitmentPosition(80_000, 30_000)
    p, e = p.reverse_realization(e, 10_000)
    assert p.available_to_commit_cents == 20_000 and e.available_cents == 60_000
    p, e = p.release(e, 60_000)
    assert (p.committed_cents, p.realized_cents, p.available_to_commit_cents) == (20_000, 20_000, 80_000)
    assert e.approved_cents == e.realized_cents == 20_000
    with pytest.raises(FinancialRuleError, match='RELEASE_EXCEEDS_AVAILABLE'):
        p.release(e, 1)
    with pytest.raises(FinancialRuleError, match='REVERSAL_EXCEEDS_REALIZED'):
        p.reverse_realization(e, 20_001)


def test_amendment_does_not_automatically_create_commitment_and_cannot_erase_reservation():
    p = ContractPosition(100_000, 80_000, 30_000).with_amended_limit(150_000)
    assert (p.committed_cents, p.realized_cents, p.available_to_commit_cents) == (80_000, 30_000, 70_000)
    with pytest.raises(FinancialRuleError, match='CONTRACT_LIMIT_EXCEEDED'):
        p.with_amended_limit(79_999)


def test_money_and_quantities_reject_float_negative_nonfinite_and_overflow():
    for amount in (-1, True, 1.1, '10', MAX_CENTS + 1):
        with pytest.raises(FinancialRuleError, match='INVALID_MONEY'):
            cents(amount)
    for quantity in ('NaN', 'Infinity', '0', '-1', '0.0000001', '1000000000000', '', 0.1):
        with pytest.raises(FinancialRuleError, match='INVALID_QUANTITY'):
            item_total(quantity, 100)
    assert item_total('55.5', 127) == 7049
    assert item_total('0.5', 1) == 1
    assert item_total('1', MAX_CENTS) == MAX_CENTS
    with pytest.raises(FinancialRuleError, match='INVALID_MONEY'):
        item_total('2', MAX_CENTS)


def test_inconsistent_aggregates_fail_before_balance_calculation():
    with pytest.raises(FinancialRuleError, match='COMMITMENT_EXCEEDED'):
        CommitmentPosition(100, 101)
    with pytest.raises(FinancialRuleError, match='CONTRACT_LIMIT_EXCEEDED'):
        ContractPosition(100, 90, 91)
    with pytest.raises(FinancialRuleError, match='INCONSISTENT_FINANCIAL_POSITION'):
        ContractPosition(1000, 1000, 900).realize(CommitmentPosition(500, 0), 1)
'''
}
for name,content in files.items():
    p=root/name
    assert not p.exists(),f'Não sobrescrever: {name}'
    p.write_text(content,encoding='utf-8')
print('Criados dois arquivos novos do núcleo de cálculo; arquivos em edição preservados.')

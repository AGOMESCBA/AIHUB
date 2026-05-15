class QueryBuilder {
  constructor(conexao) {
    this.conexao = conexao;
    this._params = {};
    this._paramIndex = 0;
  }

  // Returns next unique param name: p0, p1, ...
  _p(value) {
    const name = `p${this._paramIndex++}`;
    this._params[name] = value;
    return `@${name}`;
  }

  // Dynamic table suffix for Protheus (filial-based)
  _suffix(filial) {
    if (!filial) return '010';
    return String(filial).padStart(3, '0').slice(0, 3);
  }

  // Build the query — subclasses must implement
  build(intent) {
    throw new Error('build() deve ser implementado pela subclasse');
  }

  // Returns { sql, params }
  compile(intent) {
    this._params     = {};
    this._paramIndex = 0;
    const sql = this.build(intent);
    return { sql, params: { ...this._params } };
  }
}

module.exports = QueryBuilder;

plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.example.crypto_swing_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.example.crypto_swing_app"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    applicationVariants.all {
        outputs.configureEach {
            (this as? com.android.build.gradle.internal.api.BaseVariantOutputImpl)?.outputFileName = "app-mastercrypto.apk"
        }
    }
}

tasks.configureEach {
    if (name.startsWith("assemble")) {
        doLast {
            val srcDir = file("${layout.buildDirectory.get()}/outputs/apk")
            if (srcDir.exists()) {
                srcDir.walkTopDown().filter { it.name == "app-mastercrypto.apk" }.forEach { srcFile ->
                    val flutterApkDir = file("${layout.buildDirectory.get()}/outputs/flutter-apk")
                    flutterApkDir.mkdirs()
                    srcFile.copyTo(file("${flutterApkDir.absolutePath}/app-mastercrypto.apk"), overwrite = true)
                }
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
}

flutter {
    source = "../.."
}

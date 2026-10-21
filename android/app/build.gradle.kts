plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.serialization)
}

// CI passes a monotonically increasing build number so every published APK is
// an upgrade over the last; local builds stay at 1.
val releaseVersionCode = providers.environmentVariable("NANIME_ANDROID_VERSION_CODE").orElse("1").get().toInt()
// The release tag (android-v1.2.3) names the version; local builds are 0.0.0.
val releaseVersionName = providers.environmentVariable("NANIME_ANDROID_VERSION_NAME").orElse("0.0.0").get()
val keystorePath = providers.environmentVariable("NANIME_ANDROID_KEYSTORE").orNull

android {
    namespace = "dev.nanime.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.nanime.android"
        minSdk = 29
        targetSdk = 37
        versionCode = releaseVersionCode
        versionName = releaseVersionName
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = providers.environmentVariable("NANIME_ANDROID_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("NANIME_ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("NANIME_ANDROID_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.browser)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    // Provisional — ADR-0010 (the domain itself) is still open, and an
    // applicationId is painful to change once anything has shipped under
    // it. Revisit before the first real release, not after.
    namespace = "app.crossscreen.android"
    // 36 is the newest platform Android Studio's SDK Manager has installed
    // here; compileSdk tracks it rather than a number picked in the
    // abstract, so a build failure here is "the SDK Manager needs an
    // update", not a mismatch nobody chose on purpose.
    compileSdk = 36

    defaultConfig {
        applicationId = "app.crossscreen.android"
        // Android 8.0 — old enough to cover the overwhelming majority of
        // active devices, new enough that every `MediaProjection`-adjacent
        // API this app will eventually need (foreground service types,
        // the Android 14 start-ordering requirement) already exists to
        // branch on rather than being entirely absent. The real answer per
        // phase-4-android.md's own open questions is usage data this
        // project does not have yet — revisit once it does.
        minSdk = 26
        // 36, not 35: Play Store policy requires targeting within one
        // version of the latest at upload time, and there is no reason to
        // start a version behind on day one of the module existing.
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.webrtc)
    testImplementation(libs.junit)
}

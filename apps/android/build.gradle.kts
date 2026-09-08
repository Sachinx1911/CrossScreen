// Applied to no module directly — declares plugin versions once
// (`gradle/libs.versions.toml`) so `app/build.gradle.kts` can `apply
// false`-free reference them without repeating a version per module. There
// is only one module today; this is what keeps adding a second one
// (Phase 4's own open question about whether Android needs to view too)
// from meaning a second version string to keep in sync.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}

/**
 * Outside the pnpm graph on purpose (roadmap.md's own repo structure) —
 * Gradle and Kotlin's toolchain neither know nor need to know that the rest
 * of this repository is a pnpm workspace. `packages/protocol/schema/` is
 * where the two worlds actually meet: Kotlin message types are generated
 * from the JSON Schema TypeScript's Zod schemas already emit, not
 * hand-copied (phase-4-android.md, architecture §65).
 */

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "crossscreen-android"
include(":app")

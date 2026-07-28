# Tasks

A small Android task manager built with Kotlin, Jetpack Compose and Room.

Add tasks, tick them off, edit them, filter by state, and clear out completed
ones. Everything is stored locally — no accounts, no network.

## Stack

| Concern        | Choice                                        |
| -------------- | --------------------------------------------- |
| Language       | Kotlin 2.0                                    |
| UI             | Jetpack Compose, Material 3 (dynamic colour)  |
| Architecture   | MVVM — `ViewModel` + `StateFlow` + repository |
| Persistence    | Room (KSP)                                    |
| Min / target   | API 24 / API 35                               |

## Layout

```
app/src/main/java/com/perceptyne/tasks/
├── MainActivity.kt          entry point, hosts the Compose tree
├── TasksApplication.kt      owns the database + repository singletons
├── data/                    Room entity, DAO, database, repository
└── ui/
    ├── TaskViewModel.kt     UI state, filtering, task mutations
    ├── TaskListScreen.kt    list, filter chips, empty states
    ├── components/          task row + add/edit bottom sheet
    └── theme/               colours, typography, Material theme
```

## Building

Requires JDK 17 and the Android SDK (platform 35). With `ANDROID_HOME` set, or
by opening the project in Android Studio:

```bash
./gradlew assembleDebug          # APK at app/build/outputs/apk/debug/
./gradlew installDebug           # install onto a connected device/emulator
./gradlew testDebugUnitTest      # unit tests
./gradlew lintDebug              # Android lint
```

If you don't have the SDK locally, push the branch and let CI build it — the
`Android CI` workflow runs the tests, lint and `assembleDebug`, and uploads the
resulting APK as the `tasks-debug-apk` artifact.

## Notes

- The debug build uses the `.debug` application ID suffix, so it installs
  alongside a release build.
- Room schemas are exported to `app/schemas/`; commit those when you bump the
  database version so migrations can be diffed.
- Release builds run R8 with resource shrinking. There is no signing config
  checked in — add your own before shipping.

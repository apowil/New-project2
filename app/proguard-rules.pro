# Room generates implementations reflectively resolved at runtime; keep their names.
-keep class androidx.room.RoomDatabase
-keepclassmembers class * extends androidx.room.RoomDatabase {
    public <init>(...);
}

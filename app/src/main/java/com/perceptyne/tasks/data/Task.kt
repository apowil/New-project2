package com.perceptyne.tasks.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "tasks")
data class Task(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val notes: String = "",
    val isDone: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
)

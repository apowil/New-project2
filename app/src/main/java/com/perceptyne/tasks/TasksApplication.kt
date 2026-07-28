package com.perceptyne.tasks

import android.app.Application
import com.perceptyne.tasks.data.TaskDatabase
import com.perceptyne.tasks.data.TaskRepository

class TasksApplication : Application() {

    val repository: TaskRepository by lazy {
        TaskRepository(TaskDatabase.get(this).taskDao())
    }
}

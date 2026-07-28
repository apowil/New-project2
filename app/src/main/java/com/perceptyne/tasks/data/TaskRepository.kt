package com.perceptyne.tasks.data

import kotlinx.coroutines.flow.Flow

class TaskRepository(private val dao: TaskDao) {

    val tasks: Flow<List<Task>> = dao.observeAll()

    suspend fun add(title: String, notes: String) {
        dao.insert(Task(title = title.trim(), notes = notes.trim()))
    }

    suspend fun save(task: Task) = dao.update(task)

    suspend fun remove(task: Task) = dao.delete(task)

    suspend fun setDone(id: Long, isDone: Boolean) = dao.setDone(id, isDone)

    suspend fun clearCompleted() = dao.deleteCompleted()
}

package com.perceptyne.tasks.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.perceptyne.tasks.TasksApplication
import com.perceptyne.tasks.data.Task
import com.perceptyne.tasks.data.TaskRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class TaskFilter { ALL, ACTIVE, DONE }

data class TasksUiState(
    val tasks: List<Task> = emptyList(),
    val filter: TaskFilter = TaskFilter.ALL,
    val activeCount: Int = 0,
    val completedCount: Int = 0,
)

/** Applies [filter] to [tasks]. Kept top-level so it is unit-testable without Android. */
fun applyFilter(tasks: List<Task>, filter: TaskFilter): List<Task> = when (filter) {
    TaskFilter.ALL -> tasks
    TaskFilter.ACTIVE -> tasks.filterNot { it.isDone }
    TaskFilter.DONE -> tasks.filter { it.isDone }
}

class TaskViewModel(private val repository: TaskRepository) : ViewModel() {

    private val filter = MutableStateFlow(TaskFilter.ALL)

    val uiState: StateFlow<TasksUiState> =
        combine(repository.tasks, filter) { tasks, selected ->
            TasksUiState(
                tasks = applyFilter(tasks, selected),
                filter = selected,
                activeCount = tasks.count { !it.isDone },
                completedCount = tasks.count { it.isDone },
            )
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = TasksUiState(),
        )

    fun setFilter(value: TaskFilter) {
        filter.value = value
    }

    fun addTask(title: String, notes: String) {
        if (title.isBlank()) return
        viewModelScope.launch { repository.add(title, notes) }
    }

    fun updateTask(task: Task) {
        if (task.title.isBlank()) return
        viewModelScope.launch { repository.save(task) }
    }

    fun toggleDone(task: Task) {
        viewModelScope.launch { repository.setDone(task.id, !task.isDone) }
    }

    fun deleteTask(task: Task) {
        viewModelScope.launch { repository.remove(task) }
    }

    fun clearCompleted() {
        viewModelScope.launch { repository.clearCompleted() }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY]
                        as TasksApplication
                TaskViewModel(app.repository)
            }
        }
    }
}

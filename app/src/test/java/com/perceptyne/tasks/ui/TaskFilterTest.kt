package com.perceptyne.tasks.ui

import com.perceptyne.tasks.data.Task
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskFilterTest {

    private val tasks = listOf(
        Task(id = 1, title = "Write spec", isDone = false),
        Task(id = 2, title = "Ship build", isDone = true),
        Task(id = 3, title = "Review PR", isDone = false),
    )

    @Test
    fun `all returns every task`() {
        assertEquals(tasks, applyFilter(tasks, TaskFilter.ALL))
    }

    @Test
    fun `active returns only unfinished tasks`() {
        assertEquals(listOf(1L, 3L), applyFilter(tasks, TaskFilter.ACTIVE).map { it.id })
    }

    @Test
    fun `done returns only completed tasks`() {
        assertEquals(listOf(2L), applyFilter(tasks, TaskFilter.DONE).map { it.id })
    }

    @Test
    fun `filtering an empty list yields an empty list`() {
        TaskFilter.entries.forEach { filter ->
            assertEquals(emptyList<Task>(), applyFilter(emptyList(), filter))
        }
    }
}

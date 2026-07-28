package com.perceptyne.tasks.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.perceptyne.tasks.R
import com.perceptyne.tasks.data.Task
import com.perceptyne.tasks.ui.components.TaskEditorSheet
import com.perceptyne.tasks.ui.components.TaskRow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskListScreen(
    viewModel: TaskViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    // null = sheet closed, Task(id = 0) = adding, otherwise editing that task.
    var editing by remember { mutableStateOf<Task?>(null) }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = {
                    if (state.completedCount > 0) {
                        IconButton(onClick = viewModel::clearCompleted) {
                            Icon(
                                imageVector = Icons.Default.DeleteSweep,
                                contentDescription = stringResource(R.string.clear_completed),
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { editing = Task(title = "") }) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = stringResource(R.string.add_task),
                )
            }
        },
    ) { innerPadding ->
        Column(modifier = Modifier.padding(innerPadding)) {
            FilterRow(
                selected = state.filter,
                activeCount = state.activeCount,
                completedCount = state.completedCount,
                onSelect = viewModel::setFilter,
            )

            if (state.tasks.isEmpty()) {
                EmptyState(filter = state.filter)
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.tasks, key = { it.id }) { task ->
                        TaskRow(
                            task = task,
                            onToggle = { viewModel.toggleDone(task) },
                            onClick = { editing = task },
                            onDelete = { viewModel.deleteTask(task) },
                        )
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
            }
        }
    }

    editing?.let { task ->
        TaskEditorSheet(
            task = task,
            onDismiss = { editing = null },
            onSave = { title, notes ->
                if (task.id == 0L) {
                    viewModel.addTask(title, notes)
                } else {
                    viewModel.updateTask(task.copy(title = title.trim(), notes = notes.trim()))
                }
                editing = null
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterRow(
    selected: TaskFilter,
    activeCount: Int,
    completedCount: Int,
    onSelect: (TaskFilter) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val labels = listOf(
            TaskFilter.ALL to stringResource(R.string.filter_all, activeCount + completedCount),
            TaskFilter.ACTIVE to stringResource(R.string.filter_active, activeCount),
            TaskFilter.DONE to stringResource(R.string.filter_done, completedCount),
        )
        labels.forEach { (filter, label) ->
            FilterChip(
                selected = filter == selected,
                onClick = { onSelect(filter) },
                label = { Text(label) },
            )
        }
    }
}

@Composable
private fun EmptyState(filter: TaskFilter) {
    val message = when (filter) {
        TaskFilter.ALL -> stringResource(R.string.empty_all)
        TaskFilter.ACTIVE -> stringResource(R.string.empty_active)
        TaskFilter.DONE -> stringResource(R.string.empty_done)
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

package com.perceptyne.tasks

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.lifecycle.viewmodel.compose.viewModel
import com.perceptyne.tasks.ui.TaskListScreen
import com.perceptyne.tasks.ui.TaskViewModel
import com.perceptyne.tasks.ui.theme.TasksTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            TasksTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    val viewModel: TaskViewModel = viewModel(factory = TaskViewModel.Factory)
                    TaskListScreen(viewModel = viewModel)
                }
            }
        }
    }
}

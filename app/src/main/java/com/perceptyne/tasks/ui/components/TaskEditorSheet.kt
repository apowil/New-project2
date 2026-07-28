package com.perceptyne.tasks.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.LaunchedEffect
import com.perceptyne.tasks.R
import com.perceptyne.tasks.data.Task
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskEditorSheet(
    task: Task,
    onDismiss: () -> Unit,
    onSave: (title: String, notes: String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    var title by remember(task.id) { mutableStateOf(task.title) }
    var notes by remember(task.id) { mutableStateOf(task.notes) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(task.id) {
        // The sheet animates in, so the field needs a moment to attach before it
        // can take focus; requesting too early throws.
        delay(200)
        runCatching { focusRequester.requestFocus() }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp)
                .imePadding()
                .navigationBarsPadding(),
        ) {
            Text(
                text = stringResource(
                    if (task.id == 0L) R.string.new_task else R.string.edit_task,
                ),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 16.dp),
            )

            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text(stringResource(R.string.title)) },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
            )

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text(stringResource(R.string.notes)) },
                minLines = 3,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            )

            Button(
                onClick = { onSave(title, notes) },
                enabled = title.isNotBlank(),
                modifier = Modifier
                    .align(Alignment.End)
                    .padding(top = 16.dp),
            ) {
                Text(stringResource(R.string.save))
            }
        }
    }
}

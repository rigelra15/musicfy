// TvTransferScreen.kt

package com.example.musicfy.ui.screens.settings.importsync

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import com.example.musicfy.R
import com.example.musicfy.tvtransfer.TransferKind
import com.example.musicfy.ui.component.SettingsGroup
import com.example.musicfy.ui.component.SettingsGroupStyle
import com.example.musicfy.ui.component.SettingsItem
import com.example.musicfy.ui.component.SubSettingsScaffold
import com.example.musicfy.viewmodels.TvTransferState
import com.example.musicfy.viewmodels.TvTransferViewModel

const val TvTransferRoute = "transfer_to_tv"

/** Moves the collection to the Musicfy TV app: scan the code the TV shows, choose what goes, send. */
@Composable
fun TvTransferScreen(
    navController: NavController,
    viewModel: TvTransferViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.startScanning() else viewModel.cameraDenied()
    }
    fun scan() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) viewModel.startScanning()
        else permission.launch(Manifest.permission.CAMERA)
    }

    SubSettingsScaffold(
        title = "Transfer to TV",
        onBack = {
            if (state is TvTransferState.Intro || state is TvTransferState.Done || state is TvTransferState.Failed) navController.navigateUp() else viewModel.cancel()
        },
    ) {
        when (val current = state) {
            TvTransferState.Intro -> {
                ImportInfoCard {
                    Text("Move your library to the Musicfy TV app over your home Wi-Fi. Nothing goes through the internet and nothing leaves your phone until you confirm.", style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(16.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Step(1, "On the TV open Library, then Import and backup, then Connect phone. A code appears.")
                        Step(2, "Keep the phone and the TV on the same Wi-Fi.")
                        Step(3, "Tap Scan the code below and point the camera at the TV.")
                    }
                }
                Spacer(Modifier.height(16.dp))
                SettingsGroup(
                    style = SettingsGroupStyle.Grouped,
                    items = listOf(
                        SettingsItem(
                            title = { Text("Scan the code") },
                            descriptionText = "Uses the camera, only on this screen",
                            icon = painterResource(R.drawable.cast),
                            iconShape = CircleShape,
                            onClick = ::scan,
                        ),
                    ),
                )
            }

            TvTransferState.Scanning -> {
                Text("Point the camera at the code on the TV.", style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(12.dp))
                Box(modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(28.dp))) {
                    QrScannerView(modifier = Modifier.fillMaxWidth().aspectRatio(1f), onCode = viewModel::onCode)
                }
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = viewModel::cancel, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
            }

            is TvTransferState.Connecting -> {
                ImportInfoCard {
                    Text("Connecting to ${current.tvName}…", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = viewModel::cancel, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
            }

            is TvTransferState.Ready -> {
                val summary = current.summary
                ImportInfoCard {
                    Text("Connected to ${current.tvName}", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(6.dp))
                    Text("Choose what to send. The TV shows what it would add and asks before it imports anything.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(16.dp))
                Choice(
                    selected = current.choice == TransferKind.PORTABLE,
                    title = "Whole collection",
                    description = "${summary.songs} songs, ${summary.playlists} playlists, ${summary.likes} liked, ${summary.history} plays, plus pins, saved artists and albums, lyric edits and a few settings." +
                        if (summary.localFiles > 0) " ${summary.localFiles} files stored on this phone are listed, but their audio is not sent." else "",
                    onClick = { viewModel.choose(TransferKind.PORTABLE) },
                )
                Spacer(Modifier.height(10.dp))
                Choice(
                    selected = current.choice == TransferKind.CSV,
                    title = "Liked songs and playlists only",
                    description = "A CSV file. No history, pins or settings.",
                    onClick = { viewModel.choose(TransferKind.CSV) },
                )
                if (current.appleAvailable) {
                    Spacer(Modifier.height(10.dp))
                    Choice(
                        selected = current.choice == TransferKind.APPLE_SESSION,
                        title = "Apple Music account only",
                        description = "Sends your Apple Music sign-in session so the TV can play your subscription. The TV keeps it in its own service, never in a backup, and you can disconnect it on the TV. Nothing else is sent.",
                        onClick = { viewModel.choose(TransferKind.APPLE_SESSION) },
                    )
                }
                Spacer(Modifier.height(10.dp))
                Text("A collection or CSV never contains accounts, passwords, cookies, API keys or audio files. The Apple Music session is sent only when you choose it above.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(16.dp))
                Button(onClick = viewModel::send, modifier = Modifier.fillMaxWidth()) { Text("Send to ${current.tvName}") }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = viewModel::cancel, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
            }

            is TvTransferState.Sending -> {
                ImportInfoCard {
                    val percent = if (current.total > 0) (current.sent * 100 / current.total).toInt() else 0
                    Text("Sending to ${current.tvName}… $percent%", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(progress = { if (current.total > 0) current.sent.toFloat() / current.total else 0f }, modifier = Modifier.fillMaxWidth())
                }
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = viewModel::cancel, modifier = Modifier.fillMaxWidth()) { Text("Stop") }
            }

            is TvTransferState.Done -> {
                ImportInfoCard {
                    Text("Sent to ${current.tvName}", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(6.dp))
                    Text("Look at the TV: it shows what it received and asks you to confirm the import.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(16.dp))
                Button(onClick = { viewModel.reset(); navController.navigateUp() }, modifier = Modifier.fillMaxWidth()) { Text("Done") }
            }

            is TvTransferState.Failed -> {
                ImportInfoCard {
                    Text("Could not transfer", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(6.dp))
                    Text(current.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(16.dp))
                if (current.message.contains("camera", ignoreCase = true)) {
                    OutlinedButton(
                        onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Open app settings") }
                    Spacer(Modifier.height(8.dp))
                }
                Button(onClick = { viewModel.reset() }, modifier = Modifier.fillMaxWidth()) { Text("Try again") }
            }
        }
    }
}

@Composable
private fun Choice(selected: Boolean, title: String, description: String, onClick: () -> Unit) {
    ImportInfoCard(modifier = Modifier.clip(RoundedCornerShape(28.dp))) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
            RadioButton(selected = selected, onClick = onClick)
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.padding(top = 10.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Step(number: Int, text: String) {
    Row {
        Text("$number.", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

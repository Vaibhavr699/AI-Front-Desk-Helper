package com.airepcoach.app.wear.presentation

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import com.airepcoach.app.wear.Cue
import com.airepcoach.app.wear.CueStore
import kotlinx.coroutines.delay

private const val AUTO_DISMISS_MS = 10_000L

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent { CueScreen() }
  }
}

@Composable
fun CueScreen() {
  val cue by CueStore.cue.collectAsState()

  LaunchedEffect(cue) {
    if (cue != null) {
      delay(AUTO_DISMISS_MS)
      CueStore.clear()
    }
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(backgroundFor(cue))
      .clickable { CueStore.set(nextDemoCue()) },
    contentAlignment = Alignment.Center,
  ) {
    if (cue != null) {
      ActiveCue(cue!!)
    } else {
      IdleState()
    }
  }
}

// Tap the watch face to cycle demo cues — for standalone testing without a
// paired phone. Real cues arrive via CueListenerService from the phone bridge.
private var demoIndex = 0
private val DEMO_CUES = listOf(
  Cue("ASK", "yellow", "single_tap", "Ask a discovery question"),
  Cue("LISTEN", "yellow", "single_tap", "They're talking — don't interrupt"),
  Cue("CLOSE", "orange", "double_tap", "Time to ask for the sale"),
  Cue("SLOW", "red", "long_buzz", "You're talking too fast"),
  Cue("CONFIRM", "green", "single_tap", "Lock in the next step"),
)
private fun nextDemoCue(): Cue {
  val cue = DEMO_CUES[demoIndex % DEMO_CUES.size]
  demoIndex++
  return cue
}

@Composable
private fun ActiveCue(cue: Cue) {
  Column(
    modifier = Modifier.padding(12.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Text(
      text = cue.label,
      color = labelColorFor(cue.urgency),
      fontSize = 38.sp,
      fontWeight = FontWeight.Black,
      textAlign = TextAlign.Center,
    )
    if (cue.headline.isNotEmpty()) {
      Text(
        text = cue.headline,
        color = Color.White.copy(alpha = 0.8f),
        fontSize = 12.sp,
        textAlign = TextAlign.Center,
        maxLines = 2,
        modifier = Modifier.padding(top = 6.dp),
      )
    }
  }
}

@Composable
private fun IdleState() {
  Column(
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Text(
      text = "Listening…",
      color = Color.Gray,
      fontSize = 15.sp,
      fontWeight = FontWeight.Medium,
    )
    Text(
      text = "tap to test",
      color = Color.Gray.copy(alpha = 0.5f),
      fontSize = 11.sp,
      modifier = Modifier.padding(top = 4.dp),
    )
  }
}

private fun backgroundFor(cue: Cue?): Color = when (cue?.urgency) {
  "green" -> Color(0xFF0D3320)
  "yellow" -> Color(0xFF3D3300)
  "orange" -> Color(0xFF4D2600)
  "red" -> Color(0xFF4D0D0D)
  else -> Color.Black
}

private fun labelColorFor(urgency: String): Color = when (urgency) {
  "green" -> Color(0xFF4ADE80)
  "yellow" -> Color(0xFFFBBF24)
  "orange" -> Color(0xFFFB923C)
  "red" -> Color(0xFFEF4444)
  else -> Color.White
}

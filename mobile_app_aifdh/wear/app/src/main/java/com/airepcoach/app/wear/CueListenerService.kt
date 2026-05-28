package com.airepcoach.app.wear

import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.airepcoach.app.wear.presentation.MainActivity
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

private const val CUE_PATH = "/coaching-cue"
private const val CLEAR_PATH = "/clear-cue"
private const val AUTO_DISMISS_MS = 10_000L

class CueListenerService : WearableListenerService() {

  override fun onMessageReceived(event: MessageEvent) {
    when (event.path) {
      CUE_PATH -> {
        try {
          val json = JSONObject(String(event.data, Charsets.UTF_8))
          val cue = Cue(
            label = json.optString("label", ""),
            urgency = json.optString("urgency", "yellow"),
            vibration = json.optString("vibration", "single_tap"),
            headline = json.optString("headline", ""),
          )
          CueStore.set(cue)
          fireVibration(cue.vibration)
          launchActivity()
        } catch (_: Exception) {
        }
      }
      CLEAR_PATH -> {
        CueStore.clear()
      }
    }
  }

  private fun launchActivity() {
    val intent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    }
    startActivity(intent)
  }

  private fun fireVibration(type: String) {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(VIBRATOR_SERVICE) as Vibrator
    }
    val effect = when (type) {
      "double_tap" -> VibrationEffect.createWaveform(longArrayOf(0, 60, 120, 60), -1)
      "long_buzz" -> VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE)
      else -> VibrationEffect.createOneShot(90, VibrationEffect.DEFAULT_AMPLITUDE)
    }
    vibrator.vibrate(effect)
  }
}

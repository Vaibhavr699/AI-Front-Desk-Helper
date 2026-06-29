package expo.modules.audioroute

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AudioRouteModule : Module() {
  private var deviceCallback: AudioDeviceCallback? = null

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("AudioRoute")

    Events("onChange")

    Function("isExternalAudioConnected") {
      hasExternalOutput()
    }

    OnStartObserving {
      val manager = audioManager ?: return@OnStartObserving
      val callback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
          sendEvent("onChange", mapOf("connected" to hasExternalOutput()))
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
          sendEvent("onChange", mapOf("connected" to hasExternalOutput()))
        }
      }
      deviceCallback = callback
      manager.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper()))
    }

    OnStopObserving {
      deviceCallback?.let { audioManager?.unregisterAudioDeviceCallback(it) }
      deviceCallback = null
    }
  }

  private fun hasExternalOutput(): Boolean {
    val manager = audioManager ?: return false
    return manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { isExternalType(it.type) }
  }

  private fun isExternalType(type: Int): Boolean {
    val types = mutableSetOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      types.add(AudioDeviceInfo.TYPE_USB_HEADSET)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // BLE_HEADSET is private (earbud); BLE_SPEAKER is NOT — it would play
      // cue audio out loud into the room, so it is intentionally excluded.
      types.add(AudioDeviceInfo.TYPE_BLE_HEADSET)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      types.add(AudioDeviceInfo.TYPE_HEARING_AID)
    }
    return type in types
  }
}

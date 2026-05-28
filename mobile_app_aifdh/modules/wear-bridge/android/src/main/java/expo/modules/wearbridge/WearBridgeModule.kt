package expo.modules.wearbridge

import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

private const val CUE_PATH = "/coaching-cue"
private const val CLEAR_PATH = "/clear-cue"

class WearBridgeModule : Module() {
  private val scope = CoroutineScope(Dispatchers.IO)

  override fun definition() = ModuleDefinition {
    Name("WearBridge")

    AsyncFunction("sendCue") { payloadJson: String, promise: Promise ->
      scope.launch {
        try {
          val context = appContext.reactContext ?: run {
            promise.resolve(false); return@launch
          }
          val nodes = Wearable.getNodeClient(context).connectedNodes.await()
          if (nodes.isEmpty()) {
            promise.resolve(false); return@launch
          }
          val messageClient = Wearable.getMessageClient(context)
          val bytes = payloadJson.toByteArray(Charsets.UTF_8)
          for (node in nodes) {
            messageClient.sendMessage(node.id, CUE_PATH, bytes).await()
          }
          promise.resolve(true)
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
    }

    AsyncFunction("clearCue") { promise: Promise ->
      scope.launch {
        try {
          val context = appContext.reactContext ?: run {
            promise.resolve(false); return@launch
          }
          val nodes = Wearable.getNodeClient(context).connectedNodes.await()
          val messageClient = Wearable.getMessageClient(context)
          for (node in nodes) {
            messageClient.sendMessage(node.id, CLEAR_PATH, ByteArray(0)).await()
          }
          promise.resolve(true)
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
    }

    AsyncFunction("isWatchConnected") { promise: Promise ->
      scope.launch {
        try {
          val context = appContext.reactContext ?: run {
            promise.resolve(false); return@launch
          }
          val nodes = Wearable.getNodeClient(context).connectedNodes.await()
          promise.resolve(nodes.isNotEmpty())
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
    }
  }
}

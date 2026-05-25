package com.aifdh.bridge

import com.facebook.react.bridge.*
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

class WearOSBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "WearOSBridge"

    @ReactMethod
    fun connect() {
        // DataClient connects automatically via Google Play Services
    }

    @ReactMethod
    fun sendCue(jsonString: String) {
        try {
            val json = JSONObject(jsonString)
            val putDataReq = PutDataMapRequest.create("/coaching-cue").apply {
                dataMap.putString("label", json.optString("label", ""))
                dataMap.putString("urgency", json.optString("urgency", "yellow"))
                dataMap.putString("vibration", json.optString("vibration", "single_tap"))
                dataMap.putString("headline", json.optString("headline", ""))
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }

            val putDataTask = Wearable.getDataClient(reactApplicationContext)
                .putDataItem(putDataReq.asPutDataRequest().setUrgent())
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun clearCue() {
        val nodes = Wearable.getNodeClient(reactApplicationContext).connectedNodes
        nodes.addOnSuccessListener { nodeList ->
            for (node in nodeList) {
                Wearable.getMessageClient(reactApplicationContext)
                    .sendMessage(node.id, "/clear-cue", ByteArray(0))
            }
        }
    }
}

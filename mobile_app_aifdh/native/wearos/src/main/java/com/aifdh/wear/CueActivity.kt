package com.aifdh.wear

import android.app.Activity
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import android.widget.TextView
import com.google.android.gms.wearable.*
import org.json.JSONObject

class CueActivity : Activity(), DataClient.OnDataChangedListener, MessageClient.OnMessageReceivedListener {

    private lateinit var labelView: TextView
    private lateinit var headlineView: TextView
    private lateinit var rootView: android.view.View
    private var vibrator: Vibrator? = null
    private val dismissHandler = android.os.Handler(android.os.Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_cue)

        labelView = findViewById(R.id.cue_label)
        headlineView = findViewById(R.id.cue_headline)
        rootView = findViewById(R.id.cue_root)
        vibrator = getSystemService(VIBRATOR_SERVICE) as? Vibrator

        showIdle()
    }

    override fun onResume() {
        super.onResume()
        Wearable.getDataClient(this).addListener(this)
        Wearable.getMessageClient(this).addListener(this)
    }

    override fun onPause() {
        super.onPause()
        Wearable.getDataClient(this).removeListener(this)
        Wearable.getMessageClient(this).removeListener(this)
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type == DataEvent.TYPE_CHANGED && event.dataItem.uri.path == "/coaching-cue") {
                val data = DataMapItem.fromDataItem(event.dataItem).dataMap
                handleCue(
                    label = data.getString("label", ""),
                    urgency = data.getString("urgency", "yellow"),
                    vibration = data.getString("vibration", "single_tap"),
                    headline = data.getString("headline", "")
                )
            }
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == "/coaching-cue") {
            try {
                val json = JSONObject(String(event.data))
                handleCue(
                    label = json.optString("label", ""),
                    urgency = json.optString("urgency", "yellow"),
                    vibration = json.optString("vibration", "single_tap"),
                    headline = json.optString("headline", "")
                )
            } catch (_: Exception) {}
        }
        if (event.path == "/clear-cue") {
            runOnUiThread { showIdle() }
        }
    }

    private fun handleCue(label: String, urgency: String, vibration: String, headline: String) {
        if (label.isEmpty() || urgency == "clear") {
            runOnUiThread { showIdle() }
            return
        }

        runOnUiThread {
            labelView.text = label
            headlineView.text = headline
            headlineView.visibility = if (headline.isNotEmpty()) android.view.View.VISIBLE else android.view.View.GONE

            val bgColor = when (urgency) {
                "green" -> 0xFF0D3320.toInt()
                "yellow" -> 0xFF3D3300.toInt()
                "orange" -> 0xFF4D2600.toInt()
                "red" -> 0xFF4D0D0D.toInt()
                else -> 0xFF000000.toInt()
            }
            rootView.setBackgroundColor(bgColor)

            val textColor = when (urgency) {
                "green" -> 0xFF4ADE80.toInt()
                "yellow" -> 0xFFFBBF24.toInt()
                "orange" -> 0xFFFB923C.toInt()
                "red" -> 0xFFEF4444.toInt()
                else -> 0xFFFFFFFF.toInt()
            }
            labelView.setTextColor(textColor)
        }

        fireVibration(vibration)

        dismissHandler.removeCallbacksAndMessages(null)
        dismissHandler.postDelayed({ runOnUiThread { showIdle() } }, 10_000)
    }

    private fun fireVibration(type: String) {
        vibrator?.let { v ->
            when (type) {
                "double_tap" -> v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 50, 100, 50), -1))
                "long_buzz" -> v.vibrate(VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE))
                else -> v.vibrate(VibrationEffect.createOneShot(80, VibrationEffect.DEFAULT_AMPLITUDE))
            }
        }
    }

    private fun showIdle() {
        labelView.text = "…"
        headlineView.text = "Listening"
        headlineView.visibility = android.view.View.VISIBLE
        rootView.setBackgroundColor(0xFF000000.toInt())
        labelView.setTextColor(0xFF888888.toInt())
    }
}

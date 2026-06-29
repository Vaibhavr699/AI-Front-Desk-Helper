package com.airepcoach.app.wear

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class Cue(
  val label: String,
  val urgency: String,
  val vibration: String,
  val headline: String,
)

object CueStore {
  private val _cue = MutableStateFlow<Cue?>(null)
  val cue: StateFlow<Cue?> = _cue

  fun set(cue: Cue) {
    _cue.value = cue
  }

  fun clear() {
    _cue.value = null
  }
}

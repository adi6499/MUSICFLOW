package com.adi6499.sukoon

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.session.MediaButtonReceiver
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** What the web app says is playing right now. */
data class NowPlaying(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val image: String,
    val playing: Boolean,
    /** Seconds. */
    val position: Double,
    /** Seconds; 0 when unknown. */
    val duration: Double,
)

/**
 * The sound itself comes from the web app. This service does the three things
 * a web page cannot:
 *  - shows the notification and lock-screen controls (and answers headset buttons),
 *  - keeps Android from closing the app while music plays in the background,
 *  - keeps the processor and Wi-Fi awake while the screen is off.
 */
class PlaybackService : Service() {

    companion object {
        private const val CHANNEL = "playback"
        private const val NOTE_ID = 1

        @Volatile var instance: PlaybackService? = null
        @Volatile private var pending: NowPlaying? = null

        /** Set by MainActivity: passes a button press ("play", "pause", "next", "prev", "seek") to the web app. */
        @Volatile var command: ((String, Double?) -> Unit)? = null

        /** Called on the main thread whenever the web app's playback state changes. */
        fun push(context: Context, state: NowPlaying) {
            val running = instance
            if (running != null) {
                running.apply(state)
                return
            }
            // Nothing to show until something is actually playing.
            if (!state.playing || state.id.isEmpty()) return
            pending = state
            try {
                ContextCompat.startForegroundService(context, Intent(context, PlaybackService::class.java))
            } catch (_: Exception) {
                // Android refused to start it from the background; it will start on the next change in the foreground.
                pending = null
            }
        }

        fun stop() {
            instance?.shutdown()
        }
    }

    private lateinit var session: MediaSessionCompat
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var state: NowPlaying? = null
    private var art: Bitmap? = null
    private var artUrl = ""
    private var inForeground = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannel()
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaSessionCompat(this, "Sukoon").apply {
            setSessionActivity(open)
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = send("play")
                override fun onPause() = send("pause")
                override fun onSkipToNext() = send("next")
                override fun onSkipToPrevious() = send("prev")
                override fun onStop() = send("pause")
                override fun onSeekTo(pos: Long) = send("seek", pos / 1000.0)
            })
            isActive = true
        }
    }

    private fun send(name: String, value: Double? = null) {
        command?.invoke(name, value)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val first = pending
        pending = null
        if (first != null) {
            apply(first)
        } else {
            // Started by a notification or headset button. Android insists a
            // notification is shown within a few seconds of such a start.
            val current = state
            if (current != null) {
                enterForeground(buildNotification(current))
                main.postDelayed({ if (state?.playing != true) leaveForeground() }, 4000)
            } else {
                enterForeground(buildNotification(NowPlaying("", getString(R.string.app_name), "", "", "", false, 0.0, 0.0)))
                main.postDelayed({ if (state == null) shutdown() }, 1500)
            }
        }
        if (intent != null) MediaButtonReceiver.handleIntent(session, intent)
        return START_NOT_STICKY
    }

    /** Bring the notification, lock screen and locks in line with the web app. */
    fun apply(next: NowPlaying) {
        if (next.id.isEmpty()) {
            shutdown()
            return
        }
        state = next
        if (next.image != artUrl) {
            artUrl = next.image
            art = null
            loadArt(next.image)
        }
        session.setMetadata(metadataFor(next))
        session.setPlaybackState(playbackStateFor(next))
        val note = buildNotification(next)
        if (next.playing) {
            holdAwake()
            enterForeground(note)
        } else {
            letSleep()
            leaveForeground()
            show(note)
        }
    }

    private fun metadataFor(s: NowPlaying): MediaMetadataCompat {
        val b = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
        if (s.duration > 0) b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (s.duration * 1000).toLong())
        art?.let { b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
        return b.build()
    }

    private fun playbackStateFor(s: NowPlaying): PlaybackStateCompat {
        val actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_STOP
        return PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(
                if (s.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                (s.position * 1000).toLong(),
                if (s.playing) 1f else 0f,
                SystemClock.elapsedRealtime(),
            )
            .build()
    }

    private fun buildNotification(s: NowPlaying): android.app.Notification {
        val button = { action: Long -> MediaButtonReceiver.buildMediaButtonPendingIntent(this, action) }
        val builder = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(s.title)
            .setContentText(s.artist)
            .setContentIntent(session.controller.sessionActivity)
            .setDeleteIntent(button(PlaybackStateCompat.ACTION_STOP))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(s.playing)
            .addAction(R.drawable.ic_prev, getString(R.string.action_previous), button(PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
            .addAction(
                if (s.playing) R.drawable.ic_pause else R.drawable.ic_play,
                getString(if (s.playing) R.string.action_pause else R.string.action_play),
                button(PlaybackStateCompat.ACTION_PLAY_PAUSE),
            )
            .addAction(R.drawable.ic_next, getString(R.string.action_next), button(PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2),
            )
        if (s.album.isNotEmpty()) builder.setSubText(s.album)
        art?.let { builder.setLargeIcon(it) }
        return builder.build()
    }

    private fun enterForeground(note: android.app.Notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTE_ID, note)
            }
            inForeground = true
        } catch (_: Exception) {
            // Not allowed right now (the app is in the background): keep the notification up to date anyway.
            show(note)
        }
    }

    /** Paused: keep the notification, but let it be swiped away and let Android reclaim us if it must. */
    private fun leaveForeground() {
        if (!inForeground) return
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
        inForeground = false
    }

    private fun show(note: android.app.Notification) {
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTE_ID, note)
        } catch (_: Exception) {
            // Notifications are switched off for the app; playback itself is unaffected.
        }
    }

    private fun createChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(CHANNEL, getString(R.string.channel_playback), NotificationManager.IMPORTANCE_LOW).apply {
            description = getString(R.string.channel_playback_about)
            setShowBadge(false)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    /** Screen off must not stop a stream: keep the processor and Wi-Fi awake while playing. */
    private fun holdAwake() {
        try {
            if (wakeLock == null) {
                val power = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sukoon:playback").apply { setReferenceCounted(false) }
            }
            // Renewed on every change of song; the time limit is only a safety net.
            wakeLock?.acquire(3 * 60 * 60 * 1000L)
            if (wifiLock == null) {
                val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                @Suppress("DEPRECATION")
                wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "sukoon:playback").apply { setReferenceCounted(false) }
            }
            wifiLock?.acquire()
        } catch (_: Exception) {
            // Without the locks playback still works with the screen on.
        }
    }

    private fun letSleep() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
            if (wifiLock?.isHeld == true) wifiLock?.release()
        } catch (_: Exception) {
        }
    }

    /** Fetch the cover for the notification and lock screen, off the main thread. */
    private fun loadArt(url: String) {
        if (!url.startsWith("https://")) return
        worker.execute {
            var bitmap: Bitmap? = null
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.inputStream.use { stream ->
                    val bytes = stream.readBytes()
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var sample = 1
                    while (bounds.outWidth / sample > 640 || bounds.outHeight / sample > 640) sample *= 2
                    bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                }
                conn.disconnect()
            } catch (_: Exception) {
            }
            val loaded = bitmap ?: return@execute
            main.post {
                val current = state
                if (artUrl != url || current == null || instance !== this) return@post
                art = loaded
                session.setMetadata(metadataFor(current))
                val note = buildNotification(current)
                if (inForeground) enterForeground(note) else show(note)
            }
        }
    }

    /** The app was swiped away from recents: the web page (and so the sound) is gone, so go too. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        shutdown()
        super.onTaskRemoved(rootIntent)
    }

    fun shutdown() {
        state = null
        letSleep()
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (_: Exception) {
        }
        inForeground = false
        stopSelf()
    }

    override fun onDestroy() {
        letSleep()
        main.removeCallbacksAndMessages(null)
        worker.shutdownNow()
        try {
            session.isActive = false
            session.release()
        } catch (_: Exception) {
        }
        if (instance === this) instance = null
        super.onDestroy()
    }
}

package expo.modules.modakeratibubble

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs

// Deep link the bubble opens — routed by expo-router to the Chat tab.
private const val OPEN_URI = "modakerati://chat"
private const val BRAND = "#5C6BFF"

/**
 * Native Android "chat head": a draggable bubble drawn over OTHER apps via a
 * TYPE_APPLICATION_OVERLAY window. It appears automatically when the app is sent
 * to the background (and is enabled + permitted), and is removed when the app
 * returns to the foreground — so it never double-stacks with the in-app bubble.
 * Tapping it deep-links back into the app's chat.
 *
 * iOS/web have no equivalent; those platforms get a no-op implementation.
 */
class ModakeratiBubbleModule : Module() {
  private var bubbleView: View? = null
  private var windowManager: WindowManager? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  // Toggled from JS: only show the overlay when the app actually wants it
  // (signed in, a thesis is active, and the user enabled the feature).
  private var enabled = false

  private val appCtx: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ModakeratiBubble")

    Events("onBubblePress")

    // This platform can draw over other apps.
    Function("isSupported") { true }

    Function("hasOverlayPermission") { Settings.canDrawOverlays(appCtx) }

    // Open the system "Display over other apps" settings page for this app.
    // Resolves with the (usually still false) current state; JS re-checks on resume.
    AsyncFunction("requestOverlayPermission") {
      val ctx = appCtx
      if (Settings.canDrawOverlays(ctx)) return@AsyncFunction true
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + ctx.packageName),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      false
    }

    // Enable/disable the feature. While enabled, the bubble shows whenever the
    // app is backgrounded; disabling removes it immediately.
    Function("setEnabled") { value: Boolean ->
      enabled = value
      if (!value) mainHandler.post { hideBubble() }
    }

    Function("isShowing") { bubbleView != null }

    // Manual control (useful for testing / foreground preview).
    AsyncFunction("show") {
      val ctx = appCtx
      if (!Settings.canDrawOverlays(ctx)) return@AsyncFunction false
      mainHandler.post { showBubble(ctx) }
      true
    }

    AsyncFunction("hide") { mainHandler.post { hideBubble() } }

    // App left the foreground → pop the bubble (if the feature is on + permitted).
    OnActivityEntersBackground {
      val ctx = appContext.reactContext?.applicationContext ?: return@OnActivityEntersBackground
      if (enabled && Settings.canDrawOverlays(ctx)) mainHandler.post { showBubble(ctx) }
    }

    // App returned → remove the overlay; the in-app bubble takes over.
    OnActivityEntersForeground { mainHandler.post { hideBubble() } }

    OnDestroy { mainHandler.post { hideBubble() } }
  }

  private fun showBubble(ctx: Context) {
    if (bubbleView != null) return
    val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm

    val metrics = ctx.resources.displayMetrics
    val density = metrics.density
    val sizePx = (58 * density).toInt()
    val pad = (9 * density).toInt()

    val icon = ImageView(ctx).apply {
      setImageDrawable(ctx.packageManager.getApplicationIcon(ctx.packageName))
      scaleType = ImageView.ScaleType.CENTER_CROP
      setPadding(pad, pad, pad, pad)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(BRAND))
      }
      clipToOutline = true
      elevation = 8 * density
    }

    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      }

    val params = WindowManager.LayoutParams(
      sizePx,
      sizePx,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = metrics.widthPixels - sizePx - (12 * density).toInt()
      y = (metrics.heightPixels * 0.6).toInt()
    }

    attachDrag(icon, params, wm, density)

    try {
      wm.addView(icon, params)
      bubbleView = icon
    } catch (e: Exception) {
      bubbleView = null
    }
  }

  private fun attachDrag(
    view: View,
    params: WindowManager.LayoutParams,
    wm: WindowManager,
    density: Float,
  ) {
    var initialX = 0
    var initialY = 0
    var touchX = 0f
    var touchY = 0f
    var moved = false
    val slop = 8 * density

    view.setOnTouchListener { v, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          touchX = event.rawX
          touchY = event.rawY
          moved = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - touchX
          val dy = event.rawY - touchY
          if (abs(dx) > slop || abs(dy) > slop) moved = true
          params.x = initialX + dx.toInt()
          params.y = initialY + dy.toInt()
          try {
            wm.updateViewLayout(v, params)
          } catch (e: Exception) {
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!moved) {
            onBubbleTapped()
          } else {
            // Snap to the nearest horizontal edge.
            val screenW = v.context.resources.displayMetrics.widthPixels
            val margin = (12 * density).toInt()
            params.x =
              if (params.x + v.width / 2 < screenW / 2) margin else screenW - v.width - margin
            try {
              wm.updateViewLayout(v, params)
            } catch (e: Exception) {
            }
          }
          true
        }
        else -> false
      }
    }
  }

  private fun onBubbleTapped() {
    sendEvent("onBubblePress", mapOf<String, Any?>())
    val ctx = appContext.reactContext?.applicationContext ?: return
    // Bring the app forward to the chat. Allowed from the background because the
    // overlay permission grants a background-activity-start exemption.
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(OPEN_URI)).apply {
      setPackage(ctx.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    try {
      ctx.startActivity(intent)
    } catch (e: Exception) {
      ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { ctx.startActivity(it) }
      }
    }
    mainHandler.post { hideBubble() }
  }

  private fun hideBubble() {
    val v = bubbleView ?: return
    runCatching { windowManager?.removeView(v) }
    bubbleView = null
  }
}

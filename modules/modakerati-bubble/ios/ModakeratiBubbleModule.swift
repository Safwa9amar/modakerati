import ExpoModulesCore

// iOS has no way to draw a floating bubble over OTHER apps (no SYSTEM_ALERT_WINDOW
// equivalent), so this is a no-op. Callers should gate on `isSupported()` and fall
// back to the in-app chat head on iOS.
public class ModakeratiBubbleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ModakeratiBubble")

    Events("onBubblePress")

    Function("isSupported") { false }

    Function("hasOverlayPermission") { false }

    AsyncFunction("requestOverlayPermission") { () -> Bool in false }

    Function("setEnabled") { (_: Bool) in }

    Function("isShowing") { false }

    AsyncFunction("show") { () -> Bool in false }

    AsyncFunction("hide") { () in }
  }
}

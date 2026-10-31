package com.agrisync.shramsafal;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * Lane UPD-1 fix pass (founder D-53) — which app installed THIS app.
 *
 * The release builds ONE web bundle for the web, the APK on shramsafal.in/apk and the Play bundle
 * (.github/workflows/release-build.yml checks the hashes match), so the bundle cannot know where it
 * was installed from. The phone's "Update" asks here instead: "com.android.vending" means Google
 * Play (open the Play listing); anything else, or nothing, means a downloaded APK (open the APK page).
 *
 * Reads only this app's own install record: no permission, no dependency. Answers
 * {@code { installer: "<package>" | null }} (null = Android recorded no installer, e.g. adb or some
 * file managers). A failure to read it rejects the call; the page logs it and opens the APK page.
 * JS side: src/infrastructure/device/installSource.ts.
 */
@CapacitorPlugin(name = "InstallSource")
public class InstallSourcePlugin extends Plugin {

    @PluginMethod
    public void getInstaller(PluginCall call) {
        try {
            String installer = installerOf(getContext());
            JSObject result = new JSObject();
            result.put("installer", installer == null ? JSONObject.NULL : installer);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException | IllegalArgumentException e) {
            call.reject("Could not read which app installed ShramSafal", e);
        }
    }

    /** API 30+: InstallSourceInfo; below it the older call, the only one those phones have. */
    @SuppressWarnings("deprecation")
    static String installerOf(Context context) throws PackageManager.NameNotFoundException {
        PackageManager packageManager = context.getPackageManager();
        String self = context.getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return packageManager.getInstallSourceInfo(self).getInstallingPackageName();
        }
        return packageManager.getInstallerPackageName(self);
    }
}

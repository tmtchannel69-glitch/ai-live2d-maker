# Official Creator verification reproduction

The unmodified official Linux v0.8.6 release binary was downloaded from:
https://github.com/Inochi2D/inochi-creator/releases/download/v0.8.6/inochi-creator-linux.zip

ZIP SHA256: 799b989d5fece71f50eafb480f6efbc95d80b0cb79e907b486b39dd9e4eef86f
Binary SHA256: 2ae3b449a8bd32c826d851a5663e58f3df451b0cfbbed0aa64121ce1f1eb9bcc
Creator tag source commit: 371e5f4e21117102dbecc82371bfd9a6e2f5df02.
Embedded SDK identified from binary strings: inochi2d/0.8.6.

The downloaded official binary and its shaders were used without modification. No source patch or global package installation was needed.
Debian Xvfb and xdotool/libxdo3 packages were extracted locally into /tmp/inochi2d-runtime/x11.
The environment already supplied SDL2, Mesa, X11, dbus-run-session, ImageMagick, NumPy and Pillow.

Start Xvfb with display94, screen1280x960x24, -ac -nolisten tcp.
Start Creator with DISPLAY=:94, LIBGL_ALWAYS_SOFTWARE=1, temporary XDG_CONFIG_HOME,
XDG_CACHE_HOME, XDG_RUNTIME_DIR, and MESA_SHADER_CACHE_DIR, under dbus-run-session.
The old inherited D-Bus address was stale; a new session fixes that launch failure.
Complete the ordinary Quick Setup and allow the ten-second donation notice to finish,
then click its close button. No purchase/website link was selected.
Open minimal-complete-meta.inp by passing its absolute path as the first argument.
Enable the Parameters panel through normal application preferences.

For this1280x960 virtual display with the saved default docking:
EyeOpenL controller endpoints(157,254)/(189,254); near-half(173,254).
EyeOpenR endpoints(157,345)/(189,345); near-half(173,345).
HeadX endpoints(157,436)/(189,436); neutral(173,436).
Hold Shift for endpoints/neutral to invoke Creator's normal keypoint snapping.
The narrow slider gives0.48 at the near-half click; exact0.5 was NOT claimed here.
Coordinates and the12-pose viewport pixel audit are in check-creator-poses.py.
This is an environment-specific UI diagnostic, not a portable CI test.

Final model tested: /tmp/inochi2d-trial/minimal-complete-meta.inp and .inx.
Both source files remain9592bytes and SHA256:
18fbffbfa3816f268585fd68e9cffac5954e109a6cb5e423149d847dc43bc5dc

Copy the generated INX to creator-roundtrip.inx before saving it with Creator,
so the generator output remains unchanged. Ctrl+S serializes the editor's own
extension fields. Exit by File/Quit, start a fresh process on the saved INX,
and rerun all12 parameter poses.
The saved INX is20346bytes, SHA256:
b4cf024d98abff57579f41440c76bd69f4a762bc3edac9735d9fe8e8004fcf10

Evidence summary: /tmp/inochi2d-trial/creator-validation.json.
Detailed screenshots/reports: creator-verification-complete-meta and creator-verification-roundtrip.
All12 poses have zero viewport ROI pixel difference before/after Creator save/reload.
This verifies legacy INP/INX only, not INP2, Live2D, VTube Studio, mobile devices,
tracking, universal automatic rigging, natural image character quality or3D reconstruction.

The GUI audit is display/layout-specific. Inspect the actual parameter labels and values when repeating it; it is not a portable CI acceptance test.

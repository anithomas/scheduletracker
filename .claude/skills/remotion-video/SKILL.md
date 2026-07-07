---
name: remotion-video
description: Generate videos programmatically with code using Remotion, a React-based video framework. Use when the user asks to create, generate, render, or automate a video, animation, motion-graphics clip, or promo/demo video from code rather than a traditional video editor. Covers scaffolding a Remotion project, building compositions with React components and hooks (useCurrentFrame, interpolate, spring, Sequence), and rendering to MP4/WebM/GIF via the Remotion CLI — including the browser-download workaround needed in network-restricted sandboxes.
---

# Remotion Video Skill

Remotion lets you build videos as React components: every frame is a pure
render of `<Video/>` at a given frame number. You write TSX, Remotion's
headless-Chrome renderer screenshots each frame, and its bundled compositor
(ships with the npm package, no separate ffmpeg install needed) encodes the
frames into a video file.

## Workflow

1. **Check for an existing project.** Look for `remotion.config.ts` and a
   `src/Root.tsx` with `<Composition>` registrations. If found, add a new
   composition/component there instead of scaffolding a new project.
2. **Scaffold if needed** (see below).
3. **Write the composition** as a React component that is a deterministic
   function of `frame` — no `Date.now()`, no unseeded `Math.random()`, no
   external state that changes between renders.
4. **Preview** with `npx remotion studio` when a human can view a browser;
   otherwise skip straight to rendering.
5. **Render** with `npx remotion render` (see the browser-executable note
   below — required in most sandboxed/CI environments).
6. **Verify the output**: check the file exists, has a sane size, and
   `ffprobe`/`file` reports the expected duration/resolution/codec.

## Scaffolding a project by hand (non-interactive)

`npx create-video@latest` is interactive and prompts for a template, which
doesn't work in a non-interactive shell. Scaffold manually instead:

```bash
mkdir my-video && cd my-video
npm init -y
npm install remotion @remotion/cli @remotion/renderer react react-dom
```

Then create three files:

**`src/index.ts`** — entry point:
```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

**`src/Root.tsx`** — registers one or more compositions:
```tsx
import { Composition } from "remotion";
import { MyVideo } from "./MyVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MyVideo"
      component={MyVideo}
      durationInFrames={150} // 5s at 30fps
      fps={30}
      width={1280}
      height={720}
    />
  );
};
```

**`src/MyVideo.tsx`** — the actual video content:
```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

export const MyVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const scale = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b1220", justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity, transform: `scale(${scale})`, color: "white", fontSize: 80, fontFamily: "sans-serif" }}>
        Hello Remotion
      </div>
    </AbsoluteFill>
  );
};
```

No `tsconfig.json` is required — Remotion's esbuild-based bundler handles
TSX directly.

## Rendering

```bash
npx remotion render src/index.ts MyVideo out/video.mp4
```

Args: `<entry-point> <composition-id> <output-path>`. Useful flags:
- `--codec=h264|vp8|vp9|gif` — output format (also inferred from extension)
- `--props='{"key":"value"}'` — pass `inputProps` into the composition
- `--frames=0-29` — render a frame range only (fast smoke test)
- `--concurrency=N` — parallel render workers

### Important: headless Chrome download is often blocked in sandboxes

The first render triggers a download of a "Chrome Headless Shell" binary
from `remotion.media`. In network-restricted environments (including this
kind of sandboxed agent environment) that host isn't allowlisted and the
render fails with:

```
Error: Received a status code of 403 while downloading file https://remotion.media/...
Host not in allowlist: remotion.media.
```

**Workaround: point Remotion at an already-installed Chromium instead of
letting it download its own.** This repo's execution environment ships a
Playwright Chromium at `/opt/pw-browsers`. Use the headless-shell build
(same binary format Remotion expects):

```bash
npx remotion render src/index.ts MyVideo out/video.mp4 \
  --browser-executable=/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell
```

This was verified end-to-end: a 60-frame 1280x720 composition rendered to a
valid `out/video.mp4` (ISO Media / MP4) in a few seconds using this flag,
where the default flow failed with the 403 above.

To avoid passing the flag on every command, set it once in
`remotion.config.ts`:

```ts
import { Config } from "@remotion/cli/config";

Config.setBrowserExecutable(
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"
);
```

(The version-numbered directory name can change; glob for
`chromium_headless_shell-*` rather than hardcoding the number if scripting
this.) Outside this sandbox — e.g. on the user's own machine or a normal CI
runner with open network access — this flag isn't needed; Remotion will
download and cache Chrome Headless Shell itself on first run.

## Core concepts

- `useCurrentFrame()` — the only source of "time"; never use wall-clock time.
- `useVideoConfig()` — returns `{ fps, durationInFrames, width, height }`.
- `interpolate(frame, inputRange, outputRange, options?)` — map frame number
  to any animated value; use `extrapolateLeft/Right: "clamp"` to avoid
  values shooting outside the intended range.
- `spring({ frame, fps, config })` — physics-based easing (bounces, pops).
- `<Sequence from={f} durationInFrames={d}>` — offsets a child's frame 0 to
  start at frame `f`, for composing scenes/timelines.
- `<AbsoluteFill>` — a `position: absolute; inset: 0` full-frame container.
- `<Img>`, `<Video>`, `<Audio>`, `staticFile("name.png")` — use these
  instead of plain `<img>`/raw URLs so Remotion waits for assets to load
  before capturing a frame; put source files in a `public/` directory.
- Multiple videos = multiple `<Composition>` entries in `Root.tsx`, each
  with a unique `id` — render each by id.

## Common pitfalls

- Non-deterministic renders (random/time-based values without a frame-seeded
  RNG) cause flicker between frames since each frame is rendered
  independently, not as a continuous animation.
- Forgetting `extrapolateRight: "clamp"` on `interpolate` lets values
  overshoot after the input range ends.
- Using raw `<img>`/CSS `background-image` instead of `<Img>`/`staticFile`
  can capture frames before the image has loaded.
- `durationInFrames` / `fps` mismatches between what you intend and what's
  registered in `<Composition>` are the most common cause of a video that's
  the wrong length.

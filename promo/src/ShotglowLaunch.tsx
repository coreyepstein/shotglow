import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";

// ── Brand ────────────────────────────────────────────────────────────────────
const GRADIENT = "linear-gradient(135deg, #fb923c 0%, #ec4899 50%, #7c3aed 100%)";
const BG = "#0b0b14";
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ── The faux screenshot card ───────────────────────────────────────────────────

const Field: React.FC<{ label: string; value: string; redact: number; danger?: boolean }> = ({
  label,
  value,
  redact,
  danger,
}) => {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "14px 0" }}>
      <div style={{ width: 150, color: "#94a3b8", fontSize: 26, fontWeight: 600 }}>{label}</div>
      <div style={{ position: "relative", flex: 1 }}>
        <div style={{ color: "#0f172a", fontSize: 30, fontWeight: 600, letterSpacing: -0.3 }}>{value}</div>
        {redact > 0 && (
          <div
            style={{
              position: "absolute",
              top: -4,
              left: -8,
              height: 46,
              width: `calc(${redact * 100}% + 16px)`,
              borderRadius: 10,
              background: danger ? "#111827" : "#1f2937",
              boxShadow: "0 1px 0 rgba(255,255,255,0.04)",
            }}
          />
        )}
      </div>
    </div>
  );
};

const ScreenshotCard: React.FC<{ redact: number }> = ({ redact }) => {
  return (
    <div
      style={{
        width: 660,
        background: "#ffffff",
        borderRadius: "inherit",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* window header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "20px 26px",
          background: "#f1f5f9",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 99, background: "#ff5f57" }} />
        <span style={{ width: 14, height: 14, borderRadius: 99, background: "#febc2e" }} />
        <span style={{ width: 14, height: 14, borderRadius: 99, background: "#28c840" }} />
        <span style={{ marginLeft: 14, color: "#64748b", fontSize: 24, fontWeight: 600 }}>
          Account settings
        </span>
      </div>
      {/* body */}
      <div style={{ padding: "26px 36px 34px" }}>
        <Field label="Name" value="Alex Rivera" redact={0} />
        <Field label="Email" value="alex@acme-corp.com" redact={redact} />
        <Field label="API key" value="sk_live_9f2c4b8a1d" redact={redact} danger />
      </div>
    </div>
  );
};

// ── Kinetic caption ────────────────────────────────────────────────────────────

const Caption: React.FC<{ text: string; duration: number; accent?: boolean }> = ({
  text,
  duration,
  accent,
}) => {
  const frame = useCurrentFrame();
  const inProg = interpolate(frame, [0, 14], [0, 1], clamp);
  const outProg = interpolate(frame, [duration - 14, duration], [1, 0], clamp);
  const opacity = Math.min(inProg, outProg);
  const y = interpolate(inProg, [0, 1], [40, 0]);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 132,
        left: 0,
        right: 0,
        textAlign: "center",
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <span
        style={{
          fontFamily: FONT,
          fontSize: 58,
          fontWeight: 800,
          letterSpacing: -1.5,
          color: accent ? "#fff" : "#f8fafc",
          textShadow: "0 2px 24px rgba(0,0,0,0.45)",
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ── Brand lockup ─────────────────────────────────────────────────────────────

const BrandIcon: React.FC<{ size: number }> = ({ size }) => (
  <Img
    src={staticFile("icon.svg")}
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.225,
      boxShadow: "0 18px 60px rgba(124,58,237,0.5)",
    }}
  />
);

// ── Main composition ───────────────────────────────────────────────────────────

export const ShotglowLaunch: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Intro overlay (icon + wordmark) — visible 0–95, fades out.
  const introScale = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const introOpacity = interpolate(frame, [0, 16, 78, 96], [0, 1, 1, 0], clamp);

  // Card appears after intro.
  const cardIn = interpolate(frame, [92, 116], [0, 1], clamp);
  const cardScaleIn = interpolate(frame, [92, 124], [0.9, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

  // Redaction sweeps in 236–300.
  const redact = interpolate(frame, [236, 300], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });

  // Beautify 360–470: gradient blooms, card pulls back (margin), corners round, shadow lifts.
  const beautify = interpolate(frame, [360, 470], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const gradientOpacity = beautify;
  const patternOpacity = interpolate(frame, [410, 480], [0, 0.12], clamp);
  const frameRadius = interpolate(beautify, [0, 1], [4, 26]);
  const framePad = interpolate(beautify, [0, 1], [0, 96]);
  const cardScaleBeautify = interpolate(beautify, [0, 1], [1, 0.74]);
  const shadowAlpha = interpolate(beautify, [0, 1], [0.12, 0.42]);
  const shadowBlur = interpolate(beautify, [0, 1], [24, 80]);

  // Outro 590–750: lift hero up, fade in wordmark + tagline + CTA.
  const heroLift = interpolate(frame, [590, 660], [0, -96], { ...clamp, easing: Easing.out(Easing.cubic) });
  const outro = interpolate(frame, [600, 660], [0, 1], clamp);

  const cardScale = cardScaleIn * cardScaleBeautify;

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT }}>
      {/* Gradient background (blooms during beautify, persists through outro) */}
      <AbsoluteFill style={{ background: GRADIENT, opacity: gradientOpacity }} />
      {/* Soft top-left glow */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(60% 50% at 30% 25%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 70%)",
          opacity: gradientOpacity,
        }}
      />
      {/* Grid pattern overlay */}
      <AbsoluteFill
        style={{
          opacity: patternOpacity,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 44px), repeating-linear-gradient(90deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 44px)",
        }}
      />

      {/* The framed screenshot */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            opacity: cardIn,
            transform: `translateY(${heroLift}px) scale(${cardScale})`,
            padding: framePad,
            borderRadius: frameRadius + framePad,
            background: "transparent",
          }}
        >
          <div
            style={{
              borderRadius: frameRadius,
              overflow: "hidden",
              boxShadow: `0 ${20 + shadowBlur / 3}px ${shadowBlur}px rgba(0,0,0,${shadowAlpha})`,
            }}
          >
            <ScreenshotCard redact={redact} />
          </div>
        </div>
      </AbsoluteFill>

      {/* Captions */}
      <Sequence from={110} durationInFrames={120}>
        <Caption text="Every screenshot leaks something." duration={120} />
      </Sequence>
      <Sequence from={236} durationInFrames={110}>
        <Caption text="Redact what matters." duration={110} />
      </Sequence>
      <Sequence from={360} durationInFrames={100}>
        <Caption text="Drop it on a gradient." duration={100} accent />
      </Sequence>
      <Sequence from={462} durationInFrames={110}>
        <Caption text="Frame it. Make it glow." duration={110} accent />
      </Sequence>

      {/* Intro overlay */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 34,
          opacity: introOpacity,
          transform: `scale(${interpolate(introScale, [0, 1], [0.86, 1])})`,
        }}
      >
        <BrandIcon size={240} />
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3, color: "#fff" }}>Shotglow</div>
        <div style={{ fontSize: 38, fontWeight: 600, color: "#9aa4b2", letterSpacing: 0.5 }}>
          Redact · Frame · Ship
        </div>
      </AbsoluteFill>

      {/* Outro lockup */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 150,
          opacity: outro,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <BrandIcon size={104} />
            <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: -2.5, color: "#fff" }}>Shotglow</div>
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 600,
              color: "rgba(255,255,255,0.92)",
              background: "rgba(0,0,0,0.28)",
              padding: "12px 26px",
              borderRadius: 99,
              backdropFilter: "blur(4px)",
            }}
          >
            Free &amp; open-source · for Chrome
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBitrateFallbackLadder,
  buildPresentationFrameTimings,
  computeTargetBitrateForCodec,
  formatBitrateMbps,
  formatCodecLabel,
  formatResolutionTag,
  getCandidateCodecs,
  getContainerForCodec,
  normalizeEvenDimension,
  premultiplyRgbaOverBlack,
  sanitizeBitrate,
  selectBestVideoEncoder,
} from "./export-config";

describe("export-config", () => {
  it("normalizes dimensions to positive even integers", () => {
    assert.equal(normalizeEvenDimension(3840, 1920), 3840);
    assert.equal(normalizeEvenDimension(3841, 1920), 3840);
    assert.equal(normalizeEvenDimension(0, 1280), 1280);
    assert.equal(normalizeEvenDimension(Number.NaN, 720), 720);
  });

  it("sanitizes invalid or extreme bitrates safely", () => {
    assert.equal(sanitizeBitrate(null, 500_000_000), null);
    assert.equal(sanitizeBitrate(-100, 500_000_000), null);
    assert.equal(sanitizeBitrate(Number.POSITIVE_INFINITY, 500_000_000), null);
    assert.equal(sanitizeBitrate(500, 500_000_000), 1_000_000);
    assert.equal(sanitizeBitrate(999_000_000, 500_000_000), 500_000_000);
    assert.equal(sanitizeBitrate(98_500_000, 500_000_000), 98_500_000);
  });

  it("selects HEVC first in Original mode when source is HEVC and respects container locks", () => {
    assert.deepEqual(
      getCandidateCodecs("composite", "original", "hevc"),
      ["hevc", "avc", "vp9", "vp8"],
    );
    assert.deepEqual(
      getCandidateCodecs("composite", "original", "hevc", "mp4"),
      ["hevc", "avc"],
    );
    assert.deepEqual(
      getCandidateCodecs("composite", "original", "avc", "webm"),
      ["vp9", "vp8"],
    );
    assert.deepEqual(
      getCandidateCodecs("overlay-alpha", "original", "hevc", "mp4"),
      ["vp9", "vp8"],
    );
  });

  it("matches source bitrate in Original mode without 120 Mbps cap and boosts AVC fallback for HEVC sources", () => {
    const hevcMatch = computeTargetBitrateForCodec({
      mode: "composite",
      quality: "original",
      targetCodec: "hevc",
      sourceCodec: "hevc",
      sourceBitrate: 160_000_000,
      width: 5312,
      height: 2988,
    });
    assert.equal(hevcMatch, 160_000_000);

    const avcFallback = computeTargetBitrateForCodec({
      mode: "composite",
      quality: "original",
      targetCodec: "avc",
      sourceCodec: "hevc",
      sourceBitrate: 100_000_000,
      width: 3840,
      height: 2160,
    });
    assert.equal(avcFallback, 135_000_000);

    const ultra4k = computeTargetBitrateForCodec({
      mode: "composite",
      quality: "ultra",
      targetCodec: "avc",
      sourceCodec: "hevc",
      sourceBitrate: 160_000_000,
      width: 3840,
      height: 2160,
    });
    assert.equal(ultra4k, 120_000_000);
  });

  it("computes bounded bitrate for transparent alpha overlays", () => {
    const alpha1080 = computeTargetBitrateForCodec({
      mode: "overlay-alpha",
      quality: "high",
      targetCodec: "vp9",
      sourceCodec: "hevc",
      sourceBitrate: 120_000_000,
      width: 1920,
      height: 1080,
    });
    assert.equal(alpha1080, 20_000_000);

    const alpha4k = computeTargetBitrateForCodec({
      mode: "overlay-alpha",
      quality: "ultra",
      targetCodec: "vp9",
      sourceCodec: "hevc",
      sourceBitrate: 120_000_000,
      width: 3840,
      height: 2160,
    });
    assert.equal(alpha4k, 80_000_000);
  });

  it("steps down gracefully on encoder bitrate rejection before falling back to auto quality", async () => {
    const probed: { codec: string; bitrate?: number }[] = [];
    const selected = await selectBestVideoEncoder({
      mode: "composite",
      quality: "original",
      sourceCodec: "hevc",
      sourceBitrate: 140_000_000,
      width: 3840,
      height: 2160,
      preferredContainer: "mp4",
      canEncode: async (codec, bitrate) => {
        probed.push({ codec, bitrate });
        if (codec === "hevc") return false;
        return codec === "avc" && (bitrate ?? 0) <= 135_000_000;
      },
    });

    assert.ok(selected);
    assert.equal(selected.codec, "avc");
    assert.ok(selected.bitrate !== null && selected.bitrate <= 135_000_000);
    assert.equal(getContainerForCodec(selected.codec), "mp4");
    assert.equal(probed[0].codec, "hevc");
  });

  it("selects VP9 with alpha container WebM for transparent overlay mode", async () => {
    const selected = await selectBestVideoEncoder({
      mode: "overlay-alpha",
      quality: "original",
      sourceCodec: "hevc",
      sourceBitrate: 100_000_000,
      width: 3840,
      height: 2160,
      preferredContainer: "webm",
      canEncode: async (codec) => codec === "vp9",
    });

    assert.ok(selected);
    assert.equal(selected.codec, "vp9");
    assert.equal(selected.bitrate, 80_000_000);
    assert.equal(getContainerForCodec(selected.codec), "webm");
  });

  it("builds strictly descending bitrate fallback ladders", () => {
    const ladder = buildBitrateFallbackLadder(160_000_000);
    assert.equal(ladder[0], 160_000_000);
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(ladder[i] < ladder[i - 1]);
    }
  });

  it("sorts decode-order metadata packets into presentation order and fills missing durations", () => {
    const raw = [
      { timestamp: 1.0, duration: 0 },
      { timestamp: 1.05, duration: 0.0166 },
      { timestamp: 1.0167, duration: 0 },
      { timestamp: 1.0334, duration: 0.0167 },
      { timestamp: 0.5, duration: 0.0167 },
      { timestamp: 2.5, duration: 0.0167 },
    ];
    const timings = buildPresentationFrameTimings(raw, 1.0, 1.06, 60);
    assert.equal(timings.length, 4);
    assert.deepEqual(
      timings.map((t) => t.timestamp),
      [1.0, 1.0167, 1.0334, 1.05],
    );
    assert.ok(Math.abs(timings[0].duration - 0.0167) < 1e-4);
    assert.ok(Math.abs(timings[1].duration - 0.0167) < 1e-4);
  });

  it("synthesizes CFR frame timings when metadata packets are unavailable", () => {
    const timings = buildPresentationFrameTimings([], 2.0, 2.5, 30);
    assert.equal(timings.length, 15);
    assert.equal(timings[0].timestamp, 2.0);
    assert.ok(Math.abs(timings[0].duration - 1 / 30) < 1e-6);
  });

  it("formats codec, bitrate, and resolution labels cleanly", () => {
    assert.equal(formatCodecLabel("hevc"), "HEVC");
    assert.equal(formatCodecLabel("avc"), "H.264");
    assert.equal(formatCodecLabel("vp9"), "VP9");
    assert.equal(formatBitrateMbps(98_400_000), "98 Mbps");
    assert.equal(formatBitrateMbps(6_500_000), "6.5 Mbps");
    assert.equal(formatResolutionTag(5312, 2988), "5.3K");
    assert.equal(formatResolutionTag(3840, 2160), "4K");
    assert.equal(formatResolutionTag(1920, 1080), "1080p");
  });

  it("premultiplies semi-transparent RGB over black while preserving alpha channel", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 0,
      255, 255, 255, 51,
      161, 161, 170, 51,
      34, 211, 238, 128,
      244, 63, 94, 255,
    ]);
    premultiplyRgbaOverBlack(pixels);
    assert.deepEqual(Array.from(pixels), [
      0, 0, 0, 0,
      51, 51, 51, 51,
      32, 32, 34, 51,
      17, 106, 119, 128,
      244, 63, 94, 255,
    ]);
  });
});

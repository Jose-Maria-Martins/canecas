import { useEffect, useRef, useState } from "react";
import type { Pub, PubScore } from "../types";
import { api } from "../api/client";
<<<<<<< HEAD
import { stars } from "./scoreColor";
=======
import { categoryEmoji, pubPhoto, stars } from "./scoreColor";
import { Turnstile } from "./Turnstile";
>>>>>>> origin/main

interface Props {
  pub: Pub;
  score: PubScore | undefined;
  scoreBumped: boolean;
<<<<<<< HEAD
=======
  user: User | null;
  photo: string | undefined; // user-uploaded override for the hero
>>>>>>> origin/main
  onClose: () => void;
  onToast: (msg: string, gold?: boolean) => void;
  onPhoto: (pubId: string, url: string) => void;
}

type UploadState =
  | { phase: "idle" }
  | { phase: "ready"; file: File; preview: string }
  | { phase: "submitting"; preview: string }
  | { phase: "rating"; preview: string; submissionId: string }
  | { phase: "done"; preview: string; rating: number };

<<<<<<< HEAD
export function PubPanel({ pub, score, scoreBumped, onClose, onToast }: Props) {
=======
export function PubPanel({ pub, score, scoreBumped, user, photo, onClose, onRequireAuth, onToast, onPhoto }: Props) {
>>>>>>> origin/main
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const [err, setErr] = useState<string | null>(null);
  const [heroBroken, setHeroBroken] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUpload({ phase: "idle" });
    setErr(null);
    setHeroBroken(false);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [pub.id]);

  const heroSrc = photo ?? pubPhoto(pub);

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Please choose an image");
    setErr(null);
    setUpload({ phase: "ready", file, preview: URL.createObjectURL(file) });
  }

  async function submit() {
    if (upload.phase !== "ready") return;
    const preview = upload.preview;
    setUpload({ phase: "submitting", preview });
    setErr(null);
    try {
<<<<<<< HEAD
      const res = await api.submitPhoto({
        pubId: pub.id,
        file: upload.file,
        latitude: pub.lat,
        longitude: pub.lon,
      });
=======
      const res = await api.submitPhoto({ pubId: pub.id, file: upload.file, turnstileToken: tsToken });
      onPhoto(pub.id, preview); // optimistic: the pin + hero adopt the new photo
>>>>>>> origin/main
      setUpload({ phase: "rating", preview, submissionId: res.submission_id });
      poll(res.submission_id, preview);
    } catch (e) {
      setErr((e as Error).message);
      setUpload({ phase: "ready", file: upload.file, preview });
    }
  }

  function poll(id: string, preview: string) {
    const tick = async () => {
      try {
        const sub = await api.getSubmission(id);
        if (sub.rating != null) {
          setUpload({ phase: "done", preview, rating: sub.rating });
          onToast(`AI vibe rating: ${sub.rating.toFixed(1)} ★`, true);
          return;
        }
      } catch {
        /* keep polling */
      }
      pollTimer.current = setTimeout(tick, 700);
    };
    pollTimer.current = setTimeout(tick, 700);
  }

  return (
    <div className="pubsheet" onClick={(e) => e.stopPropagation()}>
      <div className="hero">
        <div className="grab" />
        {!heroBroken ? (
          <img src={heroSrc} alt={pub.name} onError={() => setHeroBroken(true)} />
        ) : (
          <div className="fallback">{categoryEmoji(pub)}</div>
        )}
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="content">
        <h2>{pub.name}</h2>
        <p className="addr">{pub.address}</p>

        <div className="scorebox">
          <div className={"bigscore" + (scoreBumped ? " bump" : "")}>
            {score ? score.weighted_score.toFixed(1) : "–"}
          </div>
          <div className="scoremeta">
            <div className="stars">{stars(score?.weighted_score ?? 0)}</div>
            <div>
              <b>{score?.rating_count ?? 0}</b> pours · avg{" "}
              <b>{score ? score.avg_rating.toFixed(2) : "–"}</b>
            </div>
<<<<<<< HEAD
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="bigscore" style={{ fontSize: 26 }}>{upload.rating.toFixed(1)}</span>
              <span className="scoremeta">AI vibe score for your pour — nice one! 🍻</span>
            </div>
            <button className="btn" onClick={() => setUpload({ phase: "idle" })}>
              Submit another
            </button>
          </>
        ) : upload.phase === "rating" || upload.phase === "submitting" ? (
          <>
            <div className="drop has">
              <img src={upload.preview} alt="your beer" />
            </div>
            <div className="rating-pending">
              <span className="spinner" />
              {upload.phase === "submitting" ? "Uploading…" : "Workers AI is judging your pint…"}
            </div>
          </>
        ) : (
          <>
            <div
              className={"drop" + (upload.phase === "ready" ? " has" : "")}
              onClick={() => fileInput.current?.click()}
            >
              {upload.phase === "ready" ? (
                <img src={upload.preview} alt="preview" />
              ) : (
                <>📸 Tap to add a photo of your beer</>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />

            {upload.phase === "ready" && (
              <button className="btn primary" onClick={submit}>
                Rate my beer ✨
=======
            <div style={{ color: "#9aa1b0" }}>Bayesian weighted score</div>
          </div>
        </div>

        <div className="upload">
          {err && <p className="err">{err}</p>}

          {upload.phase === "done" ? (
            <>
              <div className="drop has">
                <img src={upload.preview} alt="your beer" />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="bigscore" style={{ fontSize: 28 }}>{upload.rating.toFixed(1)}</span>
                <span className="scoremeta">AI vibe score for your pour — nice one! 🍻</span>
              </div>
              <button className="btn ghost" onClick={() => setUpload({ phase: "idle" })}>
                Submit another
>>>>>>> origin/main
              </button>
            </>
          ) : upload.phase === "rating" || upload.phase === "submitting" ? (
            <>
              <div className="drop has">
                <img src={upload.preview} alt="your beer" />
              </div>
              <div className="rating-pending">
                <span className="spinner" />
                {upload.phase === "submitting" ? "Uploading…" : "Workers AI is judging your pint…"}
              </div>
            </>
          ) : (
            <>
              <div
                className={"drop" + (upload.phase === "ready" ? " has" : "")}
                onClick={() => fileInput.current?.click()}
              >
                {upload.phase === "ready" ? (
                  <img src={upload.preview} alt="preview" />
                ) : (
                  <>📸 Tap to add a photo of your beer</>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              {user ? (
                upload.phase === "ready" && (
                  <>
                    <Turnstile onToken={setTsToken} />
                    <button className="btn primary" onClick={submit} disabled={!tsToken}>
                      Rate my beer ✨
                    </button>
                  </>
                )
              ) : (
                <button className="btn primary" onClick={onRequireAuth}>
                  Sign in to rate your beer
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

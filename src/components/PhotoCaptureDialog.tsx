import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Pub } from "../types";

interface Props {
  pub: Pub;
  onClose: () => void;
  onPhoto: (pubId: string, url: string) => void;
  onRated: (rating: number) => void;
}

type Phase = "camera" | "preview" | "uploading" | "rating" | "done";

export function PhotoCaptureDialog({ pub, onClose, onPhoto, onRated }: Props) {
  const [phase, setPhase] = useState<Phase>("camera");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void startCamera();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);

  async function startCamera() {
    setError(null);
    setPhase("camera");
    setPhoto(null);
    setRating(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot access a camera.");
      return;
    }

    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      setStream(camera);
    } catch {
      setError("Allow camera access to photograph your pint.");
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("The camera is still warming up. Try again in a moment.");
      return;
    }

    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) {
      setError("Could not capture that frame. Please try again.");
      return;
    }

    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setPhoto(blob);
    setPreview(URL.createObjectURL(blob));
    setPhase("preview");
  }

  async function submit() {
    if (!photo || !preview) return;
    setError(null);
    setPhase("uploading");

    // Show the pint immediately regardless of upload outcome — a fresh object URL
    // (not `preview`) so it isn't revoked when this dialog unmounts.
    onPhoto(pub.id, URL.createObjectURL(photo));

    try {
      const file = new File([photo], "caneca.jpg", { type: "image/jpeg" });
      const response = await api.submitPhoto({
        pubId: pub.id,
        file,
        latitude: pub.lat,
        longitude: pub.lon,
      });
      setPhase("rating");
      poll(response.submission_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Photo upload failed");
      setPhase("preview");
    }
  }

  function poll(id: string) {
    const tick = async () => {
      try {
        const submission = await api.getSubmission(id);
        if (submission.rating !== null) {
          if (preview) onPhoto(pub.id, preview);
          setRating(submission.rating);
          setPhase("done");
          onRated(submission.rating);
          return;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The photo could not be rated");
        setPhase("preview");
        return;
      }
      pollTimer.current = setTimeout(tick, 900);
    };
    pollTimer.current = setTimeout(tick, 900);
  }

  return (
    <div className="photo-dialog-backdrop" onClick={onClose}>
      <section
        className="photo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Photograph your pint"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div><span>AI pint camera</span><strong>{pub.name}</strong></div>
          <button type="button" onClick={onClose} aria-label="Close camera">×</button>
        </header>

        <div className="photo-stage">
          {phase === "camera" && (
            <>
              <video ref={videoRef} autoPlay muted playsInline />
              <div className="camera-corners" aria-hidden="true" />
              {!error && (
                <button className="camera-shutter" type="button" onClick={() => void capture()} aria-label="Take photo">
                  <span />
                </button>
              )}
            </>
          )}
          {phase !== "camera" && preview && <img src={preview} alt="Your captured pint" />}
          {(phase === "uploading" || phase === "rating") && (
            <div className="photo-working">
              <i />
              <strong>{phase === "uploading" ? "Uploading your pint…" : "Workers AI is judging the pour…"}</strong>
            </div>
          )}
          {phase === "done" && rating !== null && (
            <div className="photo-verdict">
              <span>Vibe verdict</span>
              <strong>{rating.toFixed(1)}<small>/ 5</small></strong>
            </div>
          )}
        </div>

        {error && <p className="photo-error">{error}</p>}
        <footer>
          {phase === "camera" && error && (
            <button className="btn primary" type="button" onClick={() => void startCamera()}>Try camera again</button>
          )}
          {phase === "preview" && (
            <>
              <button className="btn ghost" type="button" onClick={() => void startCamera()}>Retake</button>
              <button className="btn primary" type="button" onClick={() => void submit()}>Rate this pint ✨</button>
            </>
          )}
          {phase === "done" && (
            <button className="btn primary" type="button" onClick={onClose}>Back to the map</button>
          )}
        </footer>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNearestPub } from "./useNearestPub";

type PhotoStatus = "processing" | "complete" | "rejected" | "failed";

interface PhotoResult {
  submissionId: string;
  status: PhotoStatus;
  isImage: boolean;
  isBeer: boolean;
  score: number | null;
  reason: string;
}

interface UploadResponse {
  submissionId: string;
  statusUrl: string;
}

type Screen = "ready" | "camera" | "preview" | "uploading" | "waiting" | "result";

export function App() {
  const [screen, setScreen] = useState<Screen>("ready");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const location = useNearestPub();

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, screen]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openCamera() {
    setError(null);
    setResult(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      fileRef.current?.click();
      return;
    }

    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      setStream(camera);
      setScreen("camera");
    } catch {
      fileRef.current?.click();
    }
  }

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("The camera is still warming up. Try again in a moment.");
      return;
    }

    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const capture = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );

    if (!capture) {
      setError("Could not capture that frame. Please try again.");
      return;
    }

    choosePhoto(capture);
  }

  function choosePhoto(capture: Blob) {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setPhoto(capture);
    setPreviewUrl(URL.createObjectURL(capture));
    setScreen("preview");
    setError(null);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) choosePhoto(file);
  }

  function reset() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setPhoto(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setScreen("ready");
  }

  async function upload() {
    if (!photo) return;
    setScreen("uploading");
    setError(null);

    try {
      const coordinates = location.coordinates ?? (await location.locate());
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: {
          "Content-Type": photo.type || "image/jpeg",
          "Idempotency-Key": crypto.randomUUID(),
          ...(location.pub ? { "X-Caneca-Pub-Id": location.pub.id } : {}),
          ...(coordinates
            ? {
                "X-Caneca-Latitude": String(coordinates.latitude),
                "X-Caneca-Longitude": String(coordinates.longitude),
              }
            : {}),
        },
        body: photo,
      });
      const body = (await response.json()) as UploadResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || "Upload failed");

      setScreen("waiting");
      waitForResult(body.submissionId, body.statusUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
      setScreen("preview");
    }
  }

  function waitForResult(submissionId: string, statusUrl: string) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/uploads/${submissionId}/events`,
    );
    let settled = false;

    socket.onmessage = (event) => {
      const update = JSON.parse(event.data as string) as PhotoResult;
      setResult(update);
      if (update.status !== "processing") {
        settled = true;
        setScreen("result");
        socket.close(1000, "Result received");
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (!settled) void pollForResult(statusUrl);
    };
  }

  async function pollForResult(statusUrl: string) {
    try {
      const response = await fetch(statusUrl);
      if (!response.ok) throw new Error("Could not retrieve the rating");
      const update = (await response.json()) as PhotoResult;
      setResult(update);
      if (update.status === "processing") {
        window.setTimeout(() => void pollForResult(statusUrl), 2000);
      } else {
        setScreen("result");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retrieve the rating");
      setScreen("result");
    }
  }

  const waiting = screen === "uploading" || screen === "waiting";

  return (
    <main className="shell">
      <header className="masthead">
        <a className="brand" href="/" aria-label="Caneca home">caneca<span>.</span></a>
        <div className="masthead-actions">
          <a className="map-link" href="/map">Pint map</a>
          <span className="live"><i /> AI taproom</span>
        </div>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">One pint. One verdict.</p>
        <h1 id="page-title">How’s your<br /><em>beer looking?</em></h1>
        <p className="dek">Point, pour, shoot. Our pub critic rates the vibe while the head is still fresh.</p>
        <button
          className={`pub-radar is-${location.status}`}
          type="button"
          onClick={() => void location.locate()}
          disabled={location.status === "locating"}
        >
          <i aria-hidden="true" />
          <span>
            <small>{location.pub ? "Serving this round at" : "Pub radar"}</small>
            <strong>
              {location.pub?.name ||
                (location.status === "locating" ? "Finding your local..." : location.error || "Find my pub")}
            </strong>
          </span>
          <b>
            {location.pub
              ? location.pub.distanceMeters < 1_000
                ? `${location.pub.distanceMeters} m`
                : `${(location.pub.distanceMeters / 1_000).toFixed(1)} km`
              : "LOCATE"}
          </b>
        </button>
      </section>

      <section className={`camera-card ${screen === "camera" ? "is-camera" : ""}`}>
        {screen === "ready" && (
          <div className="ready-panel">
            <div className="pint" aria-hidden="true"><span /></div>
            <p>Best served in good light.<br />Keep the whole glass in frame.</p>
            <button className="primary" onClick={openCamera}>Open camera <span>↗</span></button>
            <button className="text-button" onClick={() => fileRef.current?.click()}>or choose a photo</button>
          </div>
        )}

        {screen === "camera" && (
          <div className="viewfinder">
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="corners" aria-hidden="true" />
            <button className="close" onClick={reset} aria-label="Close camera">×</button>
            <button className="shutter" onClick={takePhoto} aria-label="Take photo"><span /></button>
          </div>
        )}

        {(screen === "preview" || waiting) && previewUrl && (
          <div className="preview-panel">
            <img src={previewUrl} alt="Your beer submission" />
            {waiting ? (
              <div className="working">
                <div className="foam-loader"><i /><i /><i /></div>
                <strong>{screen === "uploading" ? "Sending your round…" : "The critic is tasting…"}</strong>
                <span>{screen === "waiting" ? "Live result connected" : "Uploading to Cloudflare"}</span>
              </div>
            ) : (
              <div className="preview-actions">
                <button className="secondary" onClick={reset}>Retake</button>
                <button className="primary" onClick={upload}>Rate this pint <span>→</span></button>
              </div>
            )}
          </div>
        )}

        {screen === "result" && (
          <div className="result-panel">
            {result?.status === "complete" && result.score !== null ? (
              <>
                <p className="stamp">Vibe verdict</p>
                <div className="score"><strong>{result.score.toFixed(1)}</strong><span>/ 5</span></div>
                <div className="meter"><i style={{ width: `${result.score * 20}%` }} /></div>
                <blockquote>“{result.reason}”</blockquote>
                {location.pub && <p className="result-pub">Scored at {location.pub.name}</p>}
              </>
            ) : (
              <>
                <p className="stamp">No rating this round</p>
                <h2>{result?.status === "rejected" ? "We couldn’t spot a beer." : "The critic left the bar."}</h2>
                <p className="result-reason">{error || result?.reason || "Please try that photo again."}</p>
              </>
            )}
            <button className="primary" onClick={reset}>Photograph another <span>↗</span></button>
          </div>
        )}

        {error && screen !== "result" && <p className="error" role="alert">{error}</p>}
      </section>


      <input
        ref={fileRef}
        className="file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={chooseFile}
      />

      <footer><span>01</span><p>Private upload · playful score · powered by Cloudflare</p><span>05</span></footer>
    </main>
  );
}

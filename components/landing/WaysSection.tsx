/* eslint-disable @next/next/no-img-element -- the website's own small pictures, on the Webflow CDN, drawn lazily at fixed sizes */
import type { CSSProperties } from "react";
import { decorativeQrPath, WAYS_MEDIA as M } from "@/lib/ways-media";
import { WaysMotion } from "./WaysMotion";
import "./ways.css";

/**
 * The "three ways it is used" pictures from the Pulse 3D website
 * (pulse3dmedia.com/earlyaccess): the animation on a tablet in the exam
 * room, in a text message, and on a patient's phone from a printed QR code.
 *
 * Rebuilt here in plain markup with the website's own pictures, wording and
 * styles (components/landing/ways.css). The website's version runs a script
 * that does a great deal more (a scrolling hero, a sign-up form, an FAQ); the
 * only part of it this needs is "play while on screen", which is the small
 * WaysMotion component. The QR code is drawn once on the server from the
 * website's own pattern.
 *
 * It never slows the sign-in box: the pictures load lazily, the video loads
 * nothing until its picture is on screen (preload="none", no address until
 * then), it is always silent, and with "reduce motion" or data saver on it
 * never loads at all. All of it is decoration, so screen readers get one
 * sentence instead of the drawing.
 */

const QR_PATH = decorativeQrPath();

/** A silent looping clip that WaysMotion starts only when it is on screen. */
function Clip() {
  return <video data-src={M.video} muted playsInline loop preload="none" poster={M.poster} />;
}

function Badge() {
  return (
    <div className="badge">
      <img src={M.badge} width={120} height={120} loading="lazy" decoding="async" alt="" />
      <div>
        <em>Total Knee Replacement</em>
        <em>Dr. Smith</em>
      </div>
    </div>
  );
}

export function WaysSection() {
  return (
    <div className="p3d-ways" data-ways>
      <div className="ways-row" role="img" aria-label="The animation on a tablet in the exam room, in a text message, and from a QR code on a patient's phone">
        {/* 1. Show it in the room */}
        <div className="way" data-play aria-hidden="true">
          <div className="way-vis">
            <div className="tablet">
              <div className="scr">
                <div className="vw">
                  <div className="vw-top">
                    <span className="vw-burger" />
                    <img src={M.logo} width={540} height={181} loading="lazy" decoding="async" alt="" />
                    <span className="vw-search">Search</span>
                  </div>
                  <div className="vw-side">
                    <span data-i="&#8962;">Home</span>
                    <b>Orthopedic Surgery</b>
                    <span data-i="OS">Orthopedic Spine</span>
                    <span data-i="CS">Complex Spine</span>
                    <span data-i="K" className="cur">
                      Knee
                    </span>
                    <span data-i="S">Shoulder</span>
                    <span data-i="H">Hip</span>
                    <span data-i="FA">Foot &amp; Ankle</span>
                  </div>
                  <div className="vw-main">
                    <div className="vw-player">
                      <Clip />
                      <Badge />
                      <div className="vw-ctrl">
                        <i />
                      </div>
                    </div>
                    <div className="h4">Total Knee Replacement</div>
                    <div className="vw-meta">
                      <span>Knee</span>
                      <span>1:50</span>
                    </div>
                    <div className="vw-btns">
                      <span className="fav">Favorited</span>
                      <span>Send to patient</span>
                      <span className="hot">Show QR on screen</span>
                      <span>Chapters</span>
                    </div>
                  </div>
                  <div className="vw-more">
                    <b>More in Knee</b>
                    <span style={{ "--th": `url(${M.still2})` } as CSSProperties}>ACL Reconstruction</span>
                    <span style={{ "--th": `url(${M.still3})` } as CSSProperties}>Partial Knee Replacement</span>
                    <span style={{ "--th": `url(${M.still5})` } as CSSProperties}>Total Knee Replacement</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Send a link */}
        <div className="way" data-play aria-hidden="true">
          <div className="way-vis">
            <div className="iphone msg">
              <div className="ios">
                <div className="island" />
                <div className="sbar">
                  <span>9:41</span>
                  <i />
                </div>
                <div className="thread-h">
                  <span className="av">S</span>
                  <b>Smith Orthopedics &rsaquo;</b>
                </div>
                <div className="thread">
                  <small>
                    <b>Text Message</b> Today 4:12 PM
                  </small>
                  <div className="bub t1">Here&apos;s the video Dr. Smith walked you through today.</div>
                  <div className="rich t2">
                    <img src={M.still4} width={640} height={800} loading="lazy" decoding="async" alt="" />
                    <div>
                      <b>Total Knee Replacement</b>
                      <span>pulse3dmedia.com</span>
                    </div>
                  </div>
                  <div className="bub t3">Watch it with your family whenever you like.</div>
                </div>
                <div className="compose">
                  <span>Text Message</span>
                </div>
                <div className="homebar" />
              </div>
            </div>
          </div>
        </div>

        {/* 3. Scan a QR code */}
        <div className="way" data-play aria-hidden="true">
          <div className="way-vis">
            <div className="qrcard">
              <b>Scan to watch your procedure</b>
              <div className="qr">
                <svg className="qr-svg" viewBox="0 0 25 25" shapeRendering="crispEdges">
                  <path d={QR_PATH} fill="#16202a" />
                </svg>
                <span className="scan" />
              </div>
            </div>
            <div className="iphone pg">
              <div className="ios">
                <div className="island" />
                <div className="sbar">
                  <span>9:41</span>
                  <i />
                </div>
                <div className="page">
                  <img className="lg" src={M.logo} width={540} height={181} loading="lazy" decoding="async" alt="" />
                  <div className="who">
                    Dr. Smith
                    <br />
                    Smith Orthopedics
                  </div>
                  <div className="h4">Total Knee Replacement</div>
                  <p>Your surgeon shared this so you can see what happens during your operation.</p>
                  <div className="pv">
                    <Clip />
                    <Badge />
                  </div>
                  <ul>
                    <li>About 2 minutes</li>
                    <li>Once you start watching, this link works for 7 days.</li>
                  </ul>
                </div>
                <div className="homebar" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <WaysMotion />
    </div>
  );
}

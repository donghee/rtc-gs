import React, { useEffect } from 'react';

import logo from './logo.svg';
import './App.css';
//import Janus from './Janus';
import { Janus } from "janus-gateway";
import $ from 'jquery';
import offline from "./offline.jpg";

const server = "https://rtc.baribarilab.com/janus";
// server = process.env.REACT_APP_JANUS_URL;
let janusRoom = null;
let vroomHandle = null;
let myroom = 1234;
let opaqueId = "videoroom-"+Janus.randomString(12);
let mypvtid = null;
let myusername = null;

let myid = null;
let mystream = null;

var localTracks = {}, localVideos = 0;
var feeds = [], feedStreams = {};
var bitrateTimer = [];

var use_msid = false;


var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");
var doSvc = getQueryStringValue("svc");
if(doSvc === "")
  doSvc = null;
var acodec = (getQueryStringValue("acodec") !== "" ? getQueryStringValue("acodec") : null);
var vcodec = (getQueryStringValue("vcodec") !== "" ? getQueryStringValue("vcodec") : null);
var doDtx = (getQueryStringValue("dtx") === "yes" || getQueryStringValue("dtx") === "true");
var subscriber_mode = (getQueryStringValue("subscriber-mode") === "yes" || getQueryStringValue("subscriber-mode") === "true");
var use_msid = (getQueryStringValue("msid") === "yes" || getQueryStringValue("msid") === "true");

// Helper to parse query string
function getQueryStringValue(name) {
  name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
  let regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
    results = regex.exec(window.location.search);
  return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function App() {

  useEffect(() => {
    startJanusServerRoom();
    console.log(
      "Start Janus VideoRoom"
    );
  }, []);

  function startJanusServerRoom() {

    function unpublishOwnFeed() {
      // Unpublish our stream
      let unpublish = { request: "unpublish" };
      vroomHandle.send({ message: unpublish });
    }

    function publishOwnFeed(useAudio) {
      // Publish our stream

      // We want sendonly audio and video (uncomment the data track
      // too if you want to publish via datachannels as well)
      let tracks = [];
      if(useAudio)
        tracks.push({ type: 'audio', capture: true, recv: false });

      tracks.push({ type: 'video', capture: true, recv: false,
        // We may need to enable simulcast or SVC on the video track
        simulcast: doSimulcast,
        // We only support SVC for VP9 and (still WIP) AV1
        svc: ((vcodec === 'vp9' || vcodec === 'av1') && doSvc) ? doSvc : null
      });

      //~ tracks.push({ type: 'data' });

      vroomHandle.createOffer(
        {
          tracks: tracks,
          customizeSdp: function(jsep) {
            // If DTX is enabled, munge the SDP
            if(doDtx) {
              jsep.sdp = jsep.sdp
                .replace("useinbandfec=1", "useinbandfec=1;usedtx=1")
            }
          },
          success: function(jsep) {
            console.log(jsep);
            Janus.debug("Got publisher SDP!", jsep);
            let publish = { request: "configure", audio: useAudio, video: true };
            // You can force a specific codec to use when publishing by using the
            // audiocodec and videocodec properties, for instance:
            // 		publish["audiocodec"] = "opus"
            // to force Opus as the audio codec to use, or:
            // 		publish["videocodec"] = "vp9"
            // to force VP9 as the videocodec to use. In both case, though, forcing
            // a codec will only work if: (1) the codec is actually in the SDP (and
            // so the browser supports it), and (2) the codec is in the list of
            // allowed codecs in a room. With respect to the point (2) above,
            // refer to the text in janus.plugin.videoroom.jcfg for more details.
            // We allow people to specify a codec via query string, for demo purposes
            if(acodec)
              publish["audiocodec"] = acodec;
            if(vcodec)
              publish["videocodec"] = vcodec;
            vroomHandle.send({ message: publish, jsep: jsep });
          },
          error: function(error) {
            Janus.error("WebRTC error:", error);
            if(useAudio) {
              publishOwnFeed(false);
            } else {
              alert("WebRTC error... " + error.message);
            }
          }
        });

      /*
      vroomHandle.createOffer(
        {
          media: { audioRecv: false, videoRecv: false, audioSend: useAudio, videoSend: false },	
          success: function(jsep) {
            Janus.debug("Got publisher SDP!");
            Janus.debug(jsep);
            const publish = { "request": "configure", "audio": useAudio, "video": true };
            vroomHandle.send({"message": publish, "jsep": jsep});
          },
          error: function(error) {
            Janus.error("WebRTC error:", error);
            if (useAudio) {
              publishOwnFeed(false);
            }
          }
        });
        */

    }

    // Helper to escape XML tags
    function escapeXmlTags(value) {
      if(value) {
        let escapedValue = value.replace(new RegExp('<', 'g'), '&lt');
        escapedValue = escapedValue.replace(new RegExp('>', 'g'), '&gt');
        return escapedValue;
      }
    }


    function newRemoteFeed(id, display, streams) {
      // A new feed has been published, create a new plugin handle and attach to it as a subscriber
      let remoteFeed = null;
      if(!streams)
        streams = feedStreams[id];
      janusRoom.attach(
        {
          plugin: "janus.plugin.videoroom",
          opaqueId: opaqueId,
          success: function(pluginHandle) {
            remoteFeed = pluginHandle;
            remoteFeed.remoteTracks = {};
            remoteFeed.remoteVideos = 0;
            remoteFeed.simulcastStarted = false;
            remoteFeed.svcStarted = false;
            Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
            Janus.log("  -- This is a subscriber");
            // Prepare the streams to subscribe to, as an array: we have the list of
            // streams the feed is publishing, so we can choose what to pick or skip
            let subscription = [];
            for(let i in streams) {
              let stream = streams[i];
              // If the publisher is VP8/VP9 and this is an older Safari, let's avoid video
              if(stream.type === "video" && Janus.webRTCAdapter.browserDetails.browser === "safari" &&
                (stream.codec === "vp9" || (stream.codec === "vp8" && !Janus.safariVp8))) {
                Janus.warning("Publisher is using " + stream.codec.toUpperCase +
                  ", but Safari doesn't support it: disabling video stream #" + stream.mindex);
                continue;
              }
              subscription.push({
                feed: stream.id,	// This is mandatory
                mid: stream.mid		// This is optional (all streams, if missing)
              });
              // FIXME Right now, this is always the same feed: in the future, it won't
              remoteFeed.rfid = stream.id;
              remoteFeed.rfdisplay = escapeXmlTags(stream.display);
            }
            // We wait for the plugin to send us an offer
            let subscribe = {
              request: "join",
              room: myroom,
              ptype: "subscriber",
              streams: subscription,
              use_msid: use_msid,
              private_id: mypvtid
            };
            remoteFeed.send({ message: subscribe });
          },
          error: function(error) {
            Janus.error("  -- Error attaching plugin...", error);
            Janus.error("Error attaching plugin... " + error);
          },
          iceState: function(state) {
            Janus.log("ICE state (feed #" + remoteFeed.rfindex + ") changed to " + state);
          },
          webrtcState: function(on) {
            Janus.log("Janus says this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
          },
          slowLink: function(uplink, lost, mid) {
            Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
              " packets on mid " + mid + " (" + lost + " lost packets)");
          },
          onmessage: function(msg, jsep) {
            Janus.debug(" ::: Got a message (subscriber) :::", msg);
            let event = msg["videoroom"];
            Janus.debug("Event: " + event);
            if(msg["error"]) {
              Janus.error(msg["error"]);
            } else if(event) {
              if(event === "attached") {
                // Subscriber created and attached
                for(let i=1;i<6;i++) {
                  if(!feeds[i]) {
                    feeds[i] = remoteFeed;
                    remoteFeed.rfindex = i;
                    break;
                  }
                }

                Janus.log("Successfully attached to feed in room " + msg["room"]);
                $('#remote'+remoteFeed.rfindex).removeClass('hide').html(remoteFeed.rfdisplay).show();
              } else if(event === "event") {
                // Check if we got a simulcast-related event from this publisher
                let substream = msg["substream"];
                let temporal = msg["temporal"];
                if((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
                  if(!remoteFeed.simulcastStarted) {
                    remoteFeed.simulcastStarted = true;
                    // Add some new buttons
                  }
                }
                // Or maybe SVC?
                let spatial = msg["spatial_layer"];
                temporal = msg["temporal_layer"];
                if((spatial !== null && spatial !== undefined) || (temporal !== null && temporal !== undefined)) {
                  if(!remoteFeed.svcStarted) {
                    remoteFeed.svcStarted = true;
                    // Add some new buttons
                  }
                }
              } else {
                // What has just happened?
              }
            }
            if(jsep) {
              Janus.debug("Handling SDP as well...", jsep);
              let stereo = (jsep.sdp.indexOf("stereo=1") !== -1);
              // Answer and attach
              remoteFeed.createAnswer(
                {
                  jsep: jsep,
                  // We only specify data channels here, as this way in
                  // case they were offered we'll enable them. Since we
                  // don't mention audio or video tracks, we autoaccept them
                  // as recvonly (since we won't capture anything ourselves)
                  tracks: [
                    { type: 'data' }
                  ],
                  customizeSdp: function(jsep) {
                    if(stereo && jsep.sdp.indexOf("stereo=1") == -1) {
                      // Make sure that our offer contains stereo too
                      jsep.sdp = jsep.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
                    }
                  },
                  success: function(jsep) {
                    Janus.debug("Got SDP!", jsep);
                    let body = { request: "start", room: myroom };
                    remoteFeed.send({ message: body, jsep: jsep });
                  },
                  error: function(error) {
                    Janus.error("WebRTC error:", error);
                    Janus.error("WebRTC error... " + error.message);
                  }
                });
            }
          },
          // eslint-disable-next-line no-unused-vars
          onlocaltrack: function(track, on) {
            // The subscriber stream is recvonly, we don't expect anything here
          },
          onremotetrack: function(track, mid, on, metadata) {
            Janus.debug(
              "Remote feed #" + remoteFeed.rfindex +
              ", remote track (mid=" + mid + ") " +
              (on ? "added" : "removed") +
              (metadata? " (" + metadata.reason + ") ": "") + ":", track
            );
            if(!on) {
              // Track removed, get rid of the stream and the rendering
              $('#remotevideo'+remoteFeed.rfindex + '-' + mid).remove();
              if(track.kind === "video") {
                remoteFeed.remoteVideos--;
                if(remoteFeed.remoteVideos === 0) {
                  // No video, at least for now: show a placeholder
                  if($('#videoremote'+remoteFeed.rfindex + ' .no-video-container').length === 0) {
                    $('#videoremote'+remoteFeed.rfindex).append(
                      '<div class="no-video-container">' +
                      '<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
                      '<span class="no-video-text">No remote video available</span>' +
                      '</div>');
                  }
                }
              }
              delete remoteFeed.remoteTracks[mid];
              return;
            }
            // If we're here, a new track was added
            if(remoteFeed.spinner) {
              remoteFeed.spinner.stop();
              remoteFeed.spinner = null;
            }
            if($('#remotevideo' + remoteFeed.rfindex + '-' + mid).length > 0)
              return;
            if(track.kind === "audio") {
              // New audio track: create a stream out of it, and use a hidden <audio> element
              let stream = new MediaStream([track]);
              remoteFeed.remoteTracks[mid] = stream;
              Janus.log("Created remote audio stream:", stream);
              $('#videoremote'+remoteFeed.rfindex).append('<audio class="hide" id="remotevideo' + remoteFeed.rfindex + '-' + mid + '" autoplay playsinline/>');
              Janus.attachMediaStream($('#remotevideo' + remoteFeed.rfindex + '-' + mid).get(0), stream);
              if(remoteFeed.remoteVideos === 0) {
                // No video, at least for now: show a placeholder
                if($('#videoremote'+remoteFeed.rfindex + ' .no-video-container').length === 0) {
                  $('#videoremote'+remoteFeed.rfindex).append(
                    '<div class="no-video-container">' +
                    '<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
                    '<span class="no-video-text">No remote video available</span>' +
                    '</div>');
                }
              }
            } else {
              // New video track: create a stream out of it
              remoteFeed.remoteVideos++;
              $('#videoremote'+remoteFeed.rfindex + ' .no-video-container').remove();
              let stream = new MediaStream([track]);
              remoteFeed.remoteTracks[mid] = stream;
              Janus.log("Created remote video stream:", stream);
              $('#videoremote'+remoteFeed.rfindex).append('<video class="rounded centered" id="remotevideo' + remoteFeed.rfindex + '-' + mid + '" width=100% autoplay playsinline/>');
              $('#videoremote'+remoteFeed.rfindex).append(
                '<span class="label label-primary hide" id="curres'+remoteFeed.rfindex+'" style="position: absolute; bottom: 0px; left: 0px; margin: 15px;"></span>' +
                '<span class="label label-info hide" id="curbitrate'+remoteFeed.rfindex+'" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;"></span>');
              Janus.attachMediaStream($('#remotevideo' + remoteFeed.rfindex + '-' + mid).get(0), stream);
              // Note: we'll need this for additional videos too
              if(!bitrateTimer[remoteFeed.rfindex]) {
                $('#curbitrate'+remoteFeed.rfindex).removeClass('hide').show();
                bitrateTimer[remoteFeed.rfindex] = setInterval(function() {
                  if(!$("#videoremote" + remoteFeed.rfindex + ' video').get(0))
                    return;
                  // Display updated bitrate, if supported
                  let bitrate = remoteFeed.getBitrate();
                  $('#curbitrate'+remoteFeed.rfindex).text(bitrate);
                  // Check if the resolution changed too
                  let width = $("#videoremote" + remoteFeed.rfindex + ' video').get(0).videoWidth;
                  let height = $("#videoremote" + remoteFeed.rfindex + ' video').get(0).videoHeight;
                  if(width > 0 && height > 0) {
                    let res = width + 'x' + height;
                    if(remoteFeed.simulcastStarted)
                      res += ' (simulcast)';
                    else if(remoteFeed.svcStarted)
                      res += ' (SVC)';
                    $('#curres'+remoteFeed.rfindex).removeClass('hide').text(res).show();
                  }
                }, 1000);
              }
            }
          },
          oncleanup: function() {
            Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
            if(remoteFeed.spinner)
              remoteFeed.spinner.stop();
            remoteFeed.spinner = null;
            $('#remotevideo'+remoteFeed.rfindex).remove();
            $('#waitingvideo'+remoteFeed.rfindex).remove();
            $('#novideo'+remoteFeed.rfindex).remove();
            $('#curbitrate'+remoteFeed.rfindex).remove();
            $('#curres'+remoteFeed.rfindex).remove();
            if(bitrateTimer[remoteFeed.rfindex])
              clearInterval(bitrateTimer[remoteFeed.rfindex]);
            bitrateTimer[remoteFeed.rfindex] = null;
            remoteFeed.simulcastStarted = false;
            $('#simulcast'+remoteFeed.rfindex).remove();
            remoteFeed.remoteTracks = {};
            remoteFeed.remoteVideos = 0;
          }
        });
    }

    Janus.init({debug: "all", callback: function() {
      // Create session
      janusRoom = new Janus(
        {
          server: server,
          //iceServers: iceServers,
          success: function() {
            // Attach to VideoRoom plugin
            janusRoom.attach(
              {
                plugin: "janus.plugin.videoroom",
                opaqueId: opaqueId,
                success: function (pluginHandle) {
                  vroomHandle = pluginHandle;
                  Janus.log("Plugin attached! (" + vroomHandle.getPlugin() + ", id=" + vroomHandle.getId() + ")");
                  Janus.log("  -- This is a publisher/manager");
                  // Prepare the username registration
                  let reg = Janus.randomString(12);
                  const register = { "request": "join", "room": myroom, "ptype": "publisher", "display": reg };
                  myusername = reg;
                  vroomHandle.send({ "message": register });
                },
                error: function (error) {
                  Janus.error("  -- Error attaching plugin...", error);
                },
                consentDialog: function (on) {
                  Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
                },
                iceState: function(state) {
                  Janus.log("ICE state changed to " + state);
                },
                mediaState: function (medium, on) {
                  Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
                },
                webrtcState: function (on) {
                  Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
                },
                onmessage: function (msg, jsep) {
                  Janus.debug(" ::: Got a message (publisher) :::", msg);
                  let event = msg["videoroom"];
                  Janus.debug("Event: " + event);
                  if (event != undefined && event != null) {
                    if (event === "joined") {
                      // Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
                      myid = msg["id"];
                      mypvtid = msg["private_id"];
                      console.log("Successfully joined room " + msg["room"] + " with ID " + myid);

                      if(subscriber_mode) {
                      } else {
                        publishOwnFeed(false);
                      }

                      // Any new feed to attach to?
                      if(msg["publishers"]) {
                        let list = msg["publishers"];
                        Janus.debug("Got a list of available publishers/feeds:", list);
                        for(let f in list) {
                          if(list[f]["dummy"])
                            continue;
                          let id = list[f]["id"];
                          let streams = list[f]["streams"];
                          let display = list[f]["display"];
                          for(let i in streams) {
                            let stream = streams[i];
                            stream["id"] = id;
                            stream["display"] = display;
                          }
                          feedStreams[id] = streams;
                          Janus.debug("  >> [" + id + "] " + display + ":", streams);
                          newRemoteFeed(id, display, streams);
                        }
                      }

                    } else if (event === "destroyed") {
                      // The room has been destroyed
                      Janus.warn("The room has been destroyed!");
                      console.error("The room has been destroyed");
                    } else if(event === "event") {
                      // Any info on our streams or a new feed to attach to?
                      if(msg["streams"]) {
                        let streams = msg["streams"];
                        for(let i in streams) {
                          let stream = streams[i];
                          stream["id"] = myid;
                          stream["display"] = myusername;
                        }
                        feedStreams[myid] = streams;
                      } else if(msg["publishers"]) {
                        let list = msg["publishers"];
                        Janus.debug("Got a list of available publishers/feeds:", list);
                        for(let f in list) {
                          if(list[f]["dummy"])
                            continue;
                          let id = list[f]["id"];
                          let display = list[f]["display"];
                          let streams = list[f]["streams"];
                          for(let i in streams) {
                            let stream = streams[i];
                            stream["id"] = id;
                            stream["display"] = display;
                          }
                          feedStreams[id] = streams;
                          Janus.debug("  >> [" + id + "] " + display + ":", streams);
                          newRemoteFeed(id, display, streams);
                        }
                      } else if(msg["leaving"]) {
                        // One of the publishers has gone away?
                        let leaving = msg["leaving"];
                        Janus.log("Publisher left: " + leaving);
                        let remoteFeed = null;
                        for(let i=1; i<6; i++) {
                          if(feeds[i] && feeds[i].rfid == leaving) {
                            remoteFeed = feeds[i];
                            break;
                          }
                        }
                        if(remoteFeed) {
                          Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                          $('#remote'+remoteFeed.rfindex).empty().hide();
                          $('#videoremote'+remoteFeed.rfindex).empty();
                          feeds[remoteFeed.rfindex] = null;
                          remoteFeed.detach();
                        }
                        delete feedStreams[leaving];
                      } else if(msg["unpublished"]) {
                        // One of the publishers has unpublished?
                        let unpublished = msg["unpublished"];
                        Janus.log("Publisher left: " + unpublished);
                        if(unpublished === 'ok') {
                          // That's us
                          vroomHandle.hangup();
                          return;
                        }
                        let remoteFeed = null;
                        for(let i=1; i<6; i++) {
                          if(feeds[i] && feeds[i].rfid == unpublished) {
                            remoteFeed = feeds[i];
                            break;
                          }
                        }
                        if(remoteFeed) {
                          Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                          $('#remote'+remoteFeed.rfindex).empty().hide();
                          $('#videoremote'+remoteFeed.rfindex).empty();
                          feeds[remoteFeed.rfindex] = null;
                          remoteFeed.detach();
                        }
                        delete feedStreams[unpublished];
                      } else if (msg["error"]) {
                        if (msg["error_code"] === 426) {
                          // This is a "no such room" error: give a more meaningful description
                        } else {
                          alert(msg["error"]);
                        }
                      }
                    }
                  }
                  if(jsep) {
                    Janus.debug("Handling SDP as well...", jsep);
                    vroomHandle.handleRemoteJsep({jsep: jsep});
                    // Check if any of the media we wanted to publish has
                    // been rejected (e.g., wrong or unsupported codec)
                    let audio = msg["audio_codec"];
                    if (mystream && mystream.getAudioTracks() && mystream.getAudioTracks().length > 0 && !audio) {
                      // Audio has been rejected
                      alert("Our audio stream has been rejected, viewers won't hear us");
                    }
                    let video = msg["video_codec"];
                    if (mystream && mystream.getVideoTracks() && mystream.getVideoTracks().length > 0 && !video) {
                      // Video has been rejected
                      alert("Our video stream has been rejected, viewers won't see us");
                      // Hide the webcam video
                      $('#myvideo').hide();
                      $('#videolocal').append(
                        '<div class="no-video-container">' +
                        '<i class="fa fa-video-camera fa-5 no-video-icon" style="height: 100%;"></i>' +
                        '<span class="no-video-text" style="font-size: 16px;">Video rejected, no webcam</span>' +
                        '</div>');
                    }
                  }
                },
                onlocalstream: function(stream) {
                  console.log(" ::: Got a local stream :::", stream);
                  mystream = stream;
                  const video = document.querySelector('video#localvideo');
                  const videoTracks = stream.getVideoTracks();
                  console.log(`Using video device: ${videoTracks[0].label}`);
                  video.srcObject = stream;
                },
                // onremotestream: function(stream) {
                // 	// The publisher stream is sendonly, we don't expect anything here
                // },
                oncleanup: function () {
                  Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
                  mystream = null;
                }
              });
          },
          error: function(error) {
            Janus.error(error);
            alert(error);

          },
          destroyed: function() {
            console.log('destroyed');
          }
        });
    }});
  };

  return (
    <div className="App">
      <header className="App-header">
        <p>
          WebRTC Ground Station
        </p>

        <br/>

        <div id="videoremote1" className="container">
        </div>

      </header>
    </div>
  );
}

export default App;

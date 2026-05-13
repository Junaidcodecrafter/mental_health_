import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PhoneOff, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  AlertCircle
} from 'lucide-react';
import { ai, SYSTEM_INSTRUCTION, type AIPersonalitySettings } from '../services/geminiService';
import { Modality } from '@google/genai';
import { cn } from '../lib/utils';

interface LiveCallRoomProps {
  onEnd: () => void;
  onCrisis: () => void;
  settings: AIPersonalitySettings;
}

export const LiveCallRoom: React.FC<LiveCallRoomProps> = ({ onEnd, onCrisis, settings }) => {
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [audioData, setAudioData] = useState<number[]>(new Array(8).fill(0));
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const startTimeRef = useRef<number>(Date.now());

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Improved frequency tracking
  const getFrequencyData = (analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Divide into 8 chunks for visualization
    const chunkSize = Math.floor(dataArray.length / 8);
    const chunks = [];
    for (let i = 0; i < 8; i++) {
      const sum = dataArray.slice(i * chunkSize, (i + 1) * chunkSize).reduce((a, b) => a + b, 0);
      chunks.push(sum / chunkSize / 255);
    }
    return chunks;
  };

  const getVisualizerScale = () => {
    const avg = audioData.reduce((a, b) => a + b, 0) / 8;
    if (isAISpeaking) return 1 + avg * 1.5;
    return 1 + avg * 1.2;
  };

  // Crisis Detection keywords
  const CRISIS_KEYWORDS = ["suicide", "harm", "kill myself", "end my life", "jump from", "hurt myself"];

  const checkCrisis = useCallback((text: string) => {
    if (CRISIS_KEYWORDS.some(k => text.toLowerCase().includes(k))) {
      cleanup();
      onCrisis();
    }
  }, [onCrisis]);

  const cleanup = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const playNextChunk = async () => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current || !audioContextRef.current) {
      setIsAISpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsAISpeaking(true);
    
    const chunk = audioQueueRef.current.shift()!;
    const audioBuffer = audioContextRef.current.createBuffer(1, chunk.length, 24000);
    audioBuffer.getChannelData(0).set(chunk);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    
    const analyser = audioContextRef.current.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    if (isSpeakerOff) {
      const g = audioContextRef.current.createGain();
      g.gain.value = 0;
      analyser.connect(g);
      g.connect(audioContextRef.current.destination);
    } else {
      analyser.connect(audioContextRef.current.destination);
    }

    // Monitoring AI volume for visualizer
    const updateVolume = () => {
      if (!isPlayingRef.current) return;
      setAudioData(getFrequencyData(analyser));
      requestAnimationFrame(updateVolume);
    };
    updateVolume();

    source.onended = () => {
      isPlayingRef.current = false;
      playNextChunk();
    };
    source.start();
  };

  const initializeLiveSession = async () => {
    try {
      setStatus('connecting');
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      const userAnalyser = audioContextRef.current.createAnalyser();
      userAnalyser.fftSize = 256;
      sourceRef.current.connect(userAnalyser);
      sourceRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      const monitorUserVolume = () => {
        if (status === 'error') return;
        if (!isAISpeaking) {
          setAudioData(getFrequencyData(userAnalyser));
        }
        requestAnimationFrame(monitorUserVolume);
      };
      monitorUserVolume();

      const getCustomizedInstruction = (settings: AIPersonalitySettings) => {
        let instr = SYSTEM_INSTRUCTION;
        instr += `\n\nPlease adhere to the following personality traits in your speech:
        - Tone: ${settings.tone}
        - Verbosity: ${settings.verbosity}
        - Empathy Level: ${settings.empathyLevel * 100}%
        - Traits: ${settings.traits && settings.traits.length > 0 ? settings.traits.join(', ') : 'Grounded and supportive'}
        
        Since this is a VOICE conversation:
        - Keep responses even shorter than usual.
        - Avoid complex words.
        - Use natural conversational fillers like "I see," "Hmm," or "That makes sense" if appropriate for the tone.
        `;
        return instr;
      };

      const getVoiceName = (settings: AIPersonalitySettings) => {
        if (settings.tone === 'clinical') return 'Charon';
        if (settings.tone === 'humorous' || settings.tone === 'playful') return 'Puck';
        if (settings.tone === 'serene') return 'Kore';
        if (settings.traits?.includes('witty')) return 'Fenrir';
        return 'Zephyr'; // Default 'empathetic' / 'friendly'
      };

      const customizedInstruction = settings ? getCustomizedInstruction(settings) : SYSTEM_INSTRUCTION;
      const voiceName = settings ? getVoiceName(settings) : "Zephyr";

      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            setStatus('connected');
            processorRef.current!.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert Float32 pcm to Base64 (simplification)
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
              }
              const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              sessionRef.current?.sendRealtimeInput({
                audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
              });
            };
          },
          onmessage: async (msg: any) => {
            // Handle output audio
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              const binaryString = atob(audioData);
              const len = binaryString.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
              const pcm16 = new Int16Array(bytes.buffer);
              const f32 = new Float32Array(pcm16.length);
              for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;
              
              audioQueueRef.current.push(f32);
              if (!isPlayingRef.current) playNextChunk();
            }

            // Handle Interruption
            if (msg.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              setIsAISpeaking(false);
            }

            // Handle Transcripts for Safety
            const script = msg.serverContent?.modelTurn?.parts?.[0]?.text || 
                         msg.serverContent?.inputAudioTranscription?.text;
            if (script) checkCrisis(script);
          },
          onerror: (err) => {
            console.error("Live Error:", err);
            setStatus('error');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }
          },
          systemInstruction: customizedInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });

      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error("Initialization failed:", err);
      setStatus('error');
    }
  };

  useEffect(() => {
    initializeLiveSession();
    return () => cleanup();
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-brand-bg flex flex-col items-center justify-between p-12 overflow-hidden"
    >
      {/* Background Ambience */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,rgba(62,155,139,0.05),transparent)] opacity-50" />
      
      {/* Header */}
      <div className="w-full flex justify-between items-center max-w-xl">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] uppercase tracking-[0.4em] text-brand-secondary opacity-60">Live Experience</span>
        </div>
        <div className="text-brand-primary font-mono text-sm tabular-nums">
          {formatDuration(duration)}
        </div>
      </div>

      {/* Visualizer Orb */}
      <div className="relative flex-1 flex items-center justify-center w-full">
        <AnimatePresence>
          {status === 'connecting' && (
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 0.2 }}
              className="absolute text-brand-secondary text-xs uppercase tracking-widest"
            >
              Establishing connection...
            </motion.div>
          )}
        </AnimatePresence>

        {/* Outer Reactive Rings */}
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            animate={{ 
              scale: getVisualizerScale() * (1 + i * 0.2),
              rotate: i % 2 === 0 ? 360 : -360,
              opacity: [0.05, 0.1, 0.05],
              borderRadius: ["40% 60% 60% 40% / 60% 30% 70% 40%", "60% 40% 30% 70% / 40% 60% 60% 40%", "40% 60% 60% 40% / 60% 30% 70% 40%"]
            }}
            transition={{ 
              scale: { duration: 0.2 },
              rotate: { duration: 20 + i * 5, repeat: Infinity, ease: "linear" },
              opacity: { duration: 4, repeat: Infinity },
              borderRadius: { duration: 10 + i * 2, repeat: Infinity, ease: "easeInOut" }
            }}
            className="absolute border border-brand-primary/30"
            style={{ width: `${300 + i * 100}px`, height: `${300 + i * 100}px` }}
          />
        ))}

        {/* The Core Orb */}
        <motion.div
          animate={{
            scale: getVisualizerScale(),
            boxShadow: isAISpeaking 
              ? [`0 0 60px rgba(62,155,139,0.3)`, `0 0 120px rgba(62,155,139,0.5)`, `0 0 60px rgba(62,155,139,0.3)`]
              : `0 0 40px rgba(62,155,139,0.1)`,
            borderRadius: ["50%", "45% 55% 55% 45% / 55% 45% 55% 45%", "50%"]
          }}
          transition={{ 
            scale: { duration: 0.15 },
            boxShadow: { duration: 2, repeat: Infinity },
            borderRadius: { duration: 3, repeat: Infinity }
          }}
          className={cn(
            "w-56 h-56 rounded-full bg-gradient-to-tr from-brand-bg via-brand-primary/10 to-brand-primary/25 border border-white/20 relative flex items-center justify-center overflow-hidden",
            status === 'error' && "border-red-500/50"
          )}
        >
          {/* Internal Reactive Flux */}
          <div className="absolute inset-0 flex items-center justify-center">
            {audioData.map((val, i) => (
              <motion.div
                key={i}
                animate={{
                  height: 40 + val * 120,
                  opacity: 0.1 + val * 0.4,
                  backgroundColor: isAISpeaking ? "#3E9B8B" : "#ffffff"
                }}
                transition={{ duration: 0.1 }}
                className="w-2 mx-1 rounded-full blur-sm"
              />
            ))}
          </div>

          <motion.div 
            animate={{
              rotate: 360,
              scale: [1, 1.1, 1]
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 bg-brand-primary/5 blur-3xl rounded-full"
          />
          
          {status === 'error' ? (
            <AlertCircle className="text-red-500 z-10" size={32} />
          ) : (
            <motion.div 
              animate={{ 
                scale: [1, 1.2, 1],
                opacity: isAISpeaking ? 1 : 0.4
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-16 h-1 bg-brand-primary/40 rounded-full z-10 box-shadow-[0_0_20px_rgba(62,155,139,0.5)]"
            />
          )}
        </motion.div>
        
        {status === 'connected' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            className="absolute bottom-[15%] text-[10px] uppercase tracking-[0.5em] text-brand-secondary/40 font-light"
          >
            {isAISpeaking ? "Companion Resonance detected" : "Awaiting Frequency..."}
          </motion.div>
        )}
      </div>

      {/* Controls */}
      <div className="w-full max-w-md bg-white/5 border border-white/10 p-2 rounded-[40px] flex items-center justify-between gap-2 backdrop-blur-2xl">
        <button 
          onClick={() => setIsMuted(!isMuted)}
          className={cn(
            "p-5 rounded-full transition-all flex items-center justify-center",
            isMuted ? "bg-red-500/20 text-red-400" : "bg-white/5 text-brand-secondary/60 hover:text-brand-secondary hover:bg-white/10"
          )}
        >
          {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>

        <button 
          onClick={() => { cleanup(); onEnd(); }}
          className="flex-1 bg-red-500 hover:bg-red-600 text-white py-5 rounded-full transition-all flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(239,68,68,0.3)] active:scale-95"
        >
          <PhoneOff size={24} fill="currentColor" />
          <span className="font-semibold tracking-widest uppercase text-xs">End Interaction</span>
        </button>

        <button 
          onClick={() => setIsSpeakerOff(!isSpeakerOff)}
          className={cn(
            "p-5 rounded-full transition-all flex items-center justify-center",
            isSpeakerOff ? "bg-white/5 text-brand-secondary/20" : "bg-white/5 text-brand-secondary/60 hover:text-brand-secondary hover:bg-white/10"
          )}
        >
          {isSpeakerOff ? <VolumeX size={24} /> : <Volume2 size={24} />}
        </button>
      </div>

      {status === 'error' && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500/30 px-6 py-3 rounded-2xl text-red-500 text-xs tracking-widest uppercase text-center max-w-xs">
          Connection lost. Please check your mic and try again.
        </div>
      )}
    </motion.div>
  );
};

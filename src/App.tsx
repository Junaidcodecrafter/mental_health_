import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  MicOff, 
  Send, 
  LogOut, 
  Heart, 
  Wind, 
  AlertCircle,
  MessageCircle,
  User,
  Sparkles,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  Settings as SettingsIcon,
  Phone,
  Book,
  BarChart2,
  Calendar,
  Trash2,
  X
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { LiveCallRoom } from './components/LiveCallRoom';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, signOut, type User as FirebaseUser } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  limitToLast,
  type DocumentData
} from 'firebase/firestore';
import { getGeminiResponse, generateMeditationScript, summarizeCheckIn, type AIPersonalitySettings } from './services/geminiService';
import { cn } from './lib/utils';

// Types
interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: any;
  sentiment?: number;
}

interface JournalEntry {
  id: string;
  content: string;
  timestamp: any;
  mood?: string;
}

interface CheckInResponse {
  question: string;
  answer: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const CRISIS_KEYWORDS = [
  "suicide", "kill myself", "harm myself", "end my life", "want to die", 
  "dont want to live", "don't want to live", "killing myself", "harming myself",
  "self harm", "self-harm", "overdose", "take my own life", "better off dead",
  "jump off", "hanging myself", "cut my wrists", "cutting my wrists"
];

const detectCrisisKeywords = (text: string) => {
  const lowercaseText = text.toLowerCase();
  return CRISIS_KEYWORDS.some(keyword => lowercaseText.includes(keyword));
};

const MOODS = [
  { label: 'Peaceful', emoji: '😌' },
  { label: 'Grateful', emoji: '🙏' },
  { label: 'Anxious', emoji: '😰' },
  { label: 'Sad', emoji: '😢' },
  { label: 'Joyful', emoji: '😊' },
  { label: 'Angry', emoji: '😤' },
  { label: 'Tired', emoji: '😴' },
  { label: 'Focused', emoji: '🧘' },
  { label: 'Neutral', emoji: '😐' }
];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showCrisis, setShowCrisis] = useState(false);
  const [isMeditating, setIsMeditating] = useState(false);
  const [showExerciseSelection, setShowExerciseSelection] = useState(false);
  const [selectedMeditationType, setSelectedMeditationType] = useState<any>('breathing');
  const [meditationScript, setMeditationScript] = useState<string[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [meditationTimer, setMeditationTimer] = useState(0);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AIPersonalitySettings>({
    verbosity: 'normal',
    tone: 'empathetic',
    length: 'medium',
    empathyLevel: 0.8,
    traits: []
  });
  const [isInCall, setIsInCall] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [newJournalText, setNewJournalText] = useState('');
  const [selectedJournalMood, setSelectedJournalMood] = useState<string | null>(null);
  const [isSavingJournal, setIsSavingJournal] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  
  // Check-in State
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [checkInStep, setCheckInStep] = useState(0);
  const [checkInData, setCheckInData] = useState<CheckInResponse[]>([]);

  const CHECK_IN_QUESTIONS = [
    "I'm here for our daily check-in. How are you feeling right now, in this very moment?",
    "That's good to voice. Tell me a bit about your day—what have you been up to?",
    "I see. Have you managed to take any time for yourself, even just a minute of self-care?",
    "Lastly, is there anything specific weighing on your mind that you'd like to release?",
    "Thank you for sharing your day with me. I'm going to distill this into a journal entry for you. One moment..."
  ];
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        // Selection priority for high-quality female English voices
        const femaleVoice = voices.find(v => v.name === 'Samantha') || // macOS
                           voices.find(v => v.name.includes('Google US English') && v.name.includes('Female')) || // Chrome
                           voices.find(v => v.name.includes('Microsoft Zira')) || // Windows
                           voices.find(v => v.name.includes('Female') && v.lang.startsWith('en')) ||
                           voices.find(v => v.lang.startsWith('en'));
        
        if (femaleVoice) setSelectedVoice(femaleVoice);
      }
    };

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
      loadVoices();
    }

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // Persistence for Settings
  useEffect(() => {
    if (!user) return;
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, `users/${user.uid}/settings/current`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSettings(docSnap.data() as AIPersonalitySettings);
        }
      } catch (err) {
        console.error("Error fetching settings:", err);
      }
    };
    fetchSettings();
  }, [user]);

  const saveSettings = async (newSettings: AIPersonalitySettings) => {
    if (!user) return;
    setSettings(newSettings);
    try {
      await setDoc(doc(db, `users/${user.uid}/settings/current`), newSettings);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/settings/current`);
    }
  };

  // Meditation Logic
  const initiateMeditation = () => {
    setIsMeditating(true);
    setShowExerciseSelection(true);
  };

  const startMeditation = async (type: any = 'breathing') => {
    setShowExerciseSelection(false);
    setSelectedMeditationType(type);
    setCurrentLineIndex(-1);
    setIsTyping(true);
    
    try {
      const script = await generateMeditationScript(sentimentLabel.toLowerCase(), type);
      const lines = script.split('[PAUSE]').map(l => l.trim()).filter(l => l.length > 0);
      setMeditationScript(lines);
      
      const totalSeconds = lines.length * 10;
      setMeditationTimer(totalSeconds);

      // Start background audio
      const audioUrls: Record<string, string> = {
        'breathing': 'https://cdn.pixabay.com/audio/2022/05/27/audio_180873747b.mp3',
        'body-scan': 'https://cdn.pixabay.com/audio/2022/01/21/audio_31308e7a51.mp3',
        'grounding': 'https://cdn.pixabay.com/audio/2022/03/10/audio_c81604a376.mp3',
        'loving-kindness': 'https://cdn.pixabay.com/audio/2021/11/25/audio_b28e674148.mp3'
      };

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const audio = new Audio(audioUrls[type] || audioUrls.breathing);
      audio.loop = true;
      audio.volume = 0.3;
      audio.onerror = () => {
        console.warn("Meditation audio failed to load. Continuing without background music.");
        audioRef.current = null;
      };
      
      audioRef.current = audio;
      audio.play().catch(e => console.warn("Autoplay blocked or audio load failed:", e));

      // Start timer interval
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setMeditationTimer(prev => Math.max(0, prev - 1));
      }, 1000);
      
      // Guide through lines
      await runMeditationSequence(lines);
    } catch (err) {
      console.error(err);
      setIsMeditating(false);
    } finally {
      setIsTyping(false);
    }
  };

  const runMeditationSequence = async (lines: string[]) => {
    for (let i = 0; i < lines.length; i++) {
      setCurrentLineIndex(i);
      speak(lines[i]);
      // Wait for speech and then some extra time
      await new Promise(resolve => setTimeout(resolve, 8000));
    }
    // Finish
    setCurrentLineIndex(lines.length);
    setTimeout(() => stopMeditation(), 3000);
  };

  const stopMeditation = () => {
    setIsMeditating(false);
    setMeditationScript([]);
    setCurrentLineIndex(-1);
    setMeditationTimer(0);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const toggleAudio = () => {
    if (audioRef.current) {
      audioRef.current.muted = !audioRef.current.muted;
      setIsAudioMuted(audioRef.current.muted);
    }
  };

  // Theme Switcher
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => {
      unsubscribe();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Chat History Listener - Disabled automatic loading of previous chats as requested
  /*
  useEffect(() => {
    if (!user) return;

    const path = `users/${user.uid}/messages`;
    const q = query(
      collection(db, path),
      orderBy('timestamp', 'asc'),
      limitToLast(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [user]);
  */

  // Journal Listener
  useEffect(() => {
    if (!user) return;

    const path = `users/${user.uid}/journal`;
    const q = query(
      collection(db, path),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as JournalEntry));
      setJournalEntries(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [user]);

  // Scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const clearChat = async () => {
    if (!user) return;
    const path = `users/${user.uid}/messages`;
    try {
      // Clear local state
      setMessages([]);
      // Delete all messages in the current view from Firestore
      for (const msg of messages) {
        await deleteDoc(doc(db, `${path}/${msg.id}`));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  // Sentiment & Voice Logic
  const analyzeSentiment = async (text: string) => {
    // Immediate client-side check for critical keywords
    if (detectCrisisKeywords(text)) {
      setShowCrisis(true);
      return -5; // High anxiety/crisis score
    }

    try {
      const response = await fetch('/api/analyze-sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (data.isCrisis) setShowCrisis(true);
      return data.score;
    } catch (e) {
      console.error("Sentiment analysis failed", e);
      return 0;
    }
  };

  const handleSend = async (textOverride?: string) => {
    const content = typeof textOverride === 'string' ? textOverride : inputText;
    if (!content.trim() || !user) return;

    setInputText('');
    const sentimentScore = await analyzeSentiment(content);

    const path = `users/${user.uid}/messages`;
    // Add user message to Firestore
    try {
      await addDoc(collection(db, path), {
        text: content,
        sender: 'user',
        sentiment: sentimentScore,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }

    if (isCheckingIn) {
      handleCheckInResponse(content);
      return;
    }

    setIsTyping(true);

    try {
      const aiResponse = await getGeminiResponse(content, messages, settings);
      
      // Add AI response to Firestore
      await addDoc(collection(db, path), {
        text: aiResponse,
        sender: 'ai',
        timestamp: serverTimestamp(),
      });

      // Simple Text-to-Speech
      speak(aiResponse);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setIsTyping(false);
    }
  };

  // Check-in Flow Logic
  const initiateCheckIn = () => {
    setIsCheckingIn(true);
    setCheckInStep(0);
    setCheckInData([]);
    
    // Add first question to messages
    const path = `users/${user!.uid}/messages`;
    const firstQuestion = CHECK_IN_QUESTIONS[0];
    
    addDoc(collection(db, path), {
      text: firstQuestion,
      sender: 'ai',
      timestamp: serverTimestamp(),
    });
    speak(firstQuestion);
  };

  const handleCheckInResponse = async (answer: string) => {
    const nextStep = checkInStep + 1;
    const currentQuestion = CHECK_IN_QUESTIONS[checkInStep];
    
    const updatedData = [...checkInData, { question: currentQuestion, answer }];
    setCheckInData(updatedData);
    setCheckInStep(nextStep);
    setIsTyping(true);

    const path = `users/${user!.uid}/messages`;

    // Last Step: Process Summary
    if (nextStep === CHECK_IN_QUESTIONS.length - 1) {
      const finalMsg = CHECK_IN_QUESTIONS[nextStep];
      await addDoc(collection(db, path), {
        text: finalMsg,
        sender: 'ai',
        timestamp: serverTimestamp(),
      });
      speak(finalMsg);

      try {
        const { summary, mood } = await summarizeCheckIn(updatedData);
        
        // Save to Journal
        const journalPath = `users/${user!.uid}/journal`;
        await addDoc(collection(db, journalPath), {
          content: summary,
          mood: mood,
          timestamp: serverTimestamp(),
        });

        const completionMsg = "I've saved our check-in to your journal. You can reflect on it anytime. How do you feel looking at that summary?";
        await addDoc(collection(db, path), {
          text: completionMsg,
          sender: 'ai',
          timestamp: serverTimestamp(),
        });
        speak(completionMsg);
      } catch (err) {
        console.error("Check-in processing failed", err);
      } finally {
        setIsCheckingIn(false);
        setIsTyping(false);
      }
      return;
    }

    // Normal Step Transition
    const nextQuestion = CHECK_IN_QUESTIONS[nextStep];
    try {
      await addDoc(collection(db, path), {
        text: nextQuestion,
        sender: 'ai',
        timestamp: serverTimestamp(),
      });
      speak(nextQuestion);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTyping(false);
    }
  };

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95; // Slightly faster but still calm
    utterance.pitch = 1.05;
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    } else {
      // Fallback in case state hasn't updated yet
      const voices = window.speechSynthesis.getVoices();
      const fallback = voices.find(v => v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Google US English'));
      if (fallback) utterance.voice = fallback;
    }
    
    window.speechSynthesis.speak(utterance);
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0])
        .map((result: any) => result.transcript)
        .join('');
      
      if (event.results[0].isFinal) {
        setInputText(prev => prev + (prev ? ' ' : '') + transcript);
        setIsListening(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleSaveJournalEntry = async () => {
    if (!newJournalText.trim() || !user) return;
    setIsSavingJournal(true);
    const path = `users/${user.uid}/journal`;
    
    const moodToSave = selectedJournalMood 
      ? `${MOODS.find(m => m.label === selectedJournalMood)?.emoji} ${selectedJournalMood}`
      : sentimentLabel;

    try {
      await addDoc(collection(db, path), {
        content: newJournalText,
        timestamp: serverTimestamp(),
        mood: moodToSave
      });
      setNewJournalText('');
      setSelectedJournalMood(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setIsSavingJournal(false);
    }
  };

  const deleteJournalEntry = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/journal/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  // Left Sidebar stats
  const messageCount = messages.length;
  const userMessages = messages.filter(m => m.sender === 'user');
  const avgSentiment = userMessages.length > 0 
    ? userMessages.reduce((acc, curr) => acc + (curr.sentiment || 0), 0) / userMessages.length 
    : 0;

  const sentimentLabel = avgSentiment > 1 ? "Positive" : avgSentiment < -1 ? "Anxious" : "Calm";
  const sentimentWidth = `${Math.min(100, Math.max(0, (avgSentiment + 5) * 10))}%`;

  if (loading) {
    return (
      <div className="h-screen w-full bg-brand-bg flex items-center justify-center">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="text-brand-primary"
        >
          <Wind size={48} />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-brand-bg text-brand-secondary flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
        {/* Background Atmosphere */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand-accent rounded-full blur-[120px] opacity-30"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand-bg rounded-full blur-[120px] opacity-40"></div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 text-center max-w-md space-y-12"
        >
          <div className="flex justify-center">
             <div className="w-20 h-20 rounded-full border border-brand-primary flex items-center justify-center">
                <div className="w-8 h-8 bg-brand-primary rounded-full shadow-[0_0_30px_#3E9B8B] animate-pulse"></div>
             </div>
          </div>
          
          <div className="space-y-6">
            <h1 className="text-6xl font-light tracking-[0.2em] uppercase text-brand-secondary">MindfulAI</h1>
            <p className="text-slate-400 text-lg font-light leading-relaxed tracking-wide">
              An organic connection of technology and empathy. Step into your space of reflection.
            </p>
          </div>

          <button 
            onClick={signInWithGoogle}
            className="w-full py-5 px-8 bg-brand-primary text-brand-bg font-semibold rounded-full flex items-center justify-center gap-3 hover:brightness-110 transition-all transform active:scale-95 shadow-[0_0_40px_rgba(62,155,139,0.3)] tracking-widest uppercase text-sm"
          >
            <User size={20} />
            Initialize Connection
          </button>

          <p className="text-[10px] uppercase tracking-[0.3em] opacity-30">
            Self-Aware Intelligence v1.0.4
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg text-brand-secondary flex flex-col font-sans relative overflow-hidden">
      {/* Background Atmosphere */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand-accent rounded-full blur-[120px] opacity-20"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand-bg rounded-full blur-[120px] opacity-30"></div>
      </div>

      {/* Header */}
      <nav className="relative z-10 px-4 md:px-10 pt-4 md:pt-8 flex justify-between items-center bg-gradient-to-b from-brand-bg to-transparent pb-4">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-brand-primary flex items-center justify-center">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-brand-primary rounded-full shadow-[0_0_15px_#3E9B8B]"></div>
          </div>
          <span className="text-lg md:text-xl font-light tracking-[0.2em] uppercase text-brand-secondary">MindfulAI</span>
        </div>
        <div className="flex items-center gap-2 md:gap-8">
          <div className="hidden md:flex gap-8 text-[10px] font-medium tracking-widest uppercase opacity-60">
            <span 
              onClick={initiateMeditation}
              className="cursor-pointer hover:opacity-100 transition-opacity flex items-center gap-1.5"
            >
              <Moon size={12} /> Breathe
            </span>
            <span 
              onClick={() => setIsInCall(true)}
              className="cursor-pointer hover:opacity-100 transition-opacity flex items-center gap-1.5 text-brand-primary"
            >
              <Phone size={12} /> Speak
            </span>
            <span 
              onClick={() => setShowJournal(true)}
              className="cursor-pointer hover:opacity-100 transition-opacity flex items-center gap-1.5"
            >
              <Book size={12} /> Journal
            </span>
            <span 
              onClick={() => setShowInsights(true)}
              className="cursor-pointer hover:opacity-100 transition-opacity flex items-center gap-1.5"
            >
              <BarChart2 size={12} /> Insights
            </span>
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 text-slate-400 hover:text-white transition-colors"
          >
            <SettingsIcon size={18} />
          </button>
          <button 
            onClick={toggleTheme}
            className="p-2 text-slate-400 hover:text-white transition-colors"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button 
            onClick={() => signOut(auth)}
            className="p-2 pl-0 md:pl-2 text-slate-400 hover:text-white transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* Mobile Actions Quick Bar */}
      <div className="md:hidden relative z-10 px-4 w-full overflow-x-auto pb-2 scrollbar-hide flex items-center gap-6 text-[10px] font-medium tracking-widest uppercase opacity-80">
        <span 
          onClick={initiateCheckIn}
          className={cn(
            "cursor-pointer whitespace-nowrap opacity-70 hover:opacity-100 flex items-center gap-1.5",
            isCheckingIn && "text-brand-primary opacity-100"
          )}
        >
          <Calendar size={12} /> Check-in
        </span>
        <span 
          onClick={() => setIsInCall(true)}
          className="cursor-pointer whitespace-nowrap flex items-center gap-1.5 text-brand-primary"
        >
          <Phone size={12} /> Speak
        </span>
        <span 
          onClick={() => setShowJournal(true)}
          className="cursor-pointer whitespace-nowrap opacity-70 hover:opacity-100 flex items-center gap-1.5"
        >
          <Book size={12} /> Journal
        </span>
        <span 
          onClick={() => setShowInsights(true)}
          className="cursor-pointer whitespace-nowrap opacity-70 hover:opacity-100 flex items-center gap-1.5"
        >
          <BarChart2 size={12} /> Insights
        </span>
      </div>

      {/* Main Grid */}
      <main className="relative z-10 flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 px-4 md:px-10 py-2 md:py-6 overflow-hidden">
        
        {/* Left Sidebar: Memory & Insights */}
        <div className="hidden md:flex col-span-3 flex-col gap-6 overflow-y-auto scrollbar-hide pb-20">
          <div 
            onClick={initiateCheckIn}
            className={cn(
              "p-6 rounded-3xl bg-brand-surface border border-brand-border cursor-pointer transition-all hover:bg-white/5 group",
              isCheckingIn && "border-brand-primary bg-brand-primary/5 shadow-[0_0_30px_rgba(62,155,139,0.1)]"
            )}
          >
            <div className="flex items-center justify-between mb-4">
               <Calendar size={18} className={cn("text-brand-secondary/40 group-hover:text-brand-primary transition-colors", isCheckingIn && "text-brand-primary")} />
               {isCheckingIn && (
                 <div className="flex items-center gap-2">
                   <span className="text-[8px] uppercase tracking-widest text-brand-primary animate-pulse">Active</span>
                   <div className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse"></div>
                 </div>
               )}
            </div>
            <h3 className="text-xs font-light tracking-widest uppercase text-brand-secondary mb-1">Daily Check-in</h3>
            <p className="text-[10px] leading-relaxed opacity-40 uppercase tracking-wider">Mindful reflection session</p>
          </div>

          <div className="p-6 rounded-3xl bg-brand-surface border border-brand-border backdrop-blur-xl">
            <h3 className="text-[10px] uppercase tracking-[0.2em] opacity-40 mb-4">Current Sentiment</h3>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-2 flex-1 bg-white/10 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: sentimentWidth }}
                  className="h-full bg-gradient-to-r from-teal-500 to-brand-primary transition-all duration-1000"
                ></motion.div>
              </div>
              <span className="text-xs font-mono">{sentimentLabel}</span>
            </div>
            <p className="text-[11px] leading-relaxed opacity-60 italic">
              {avgSentiment < -1 ? "I sense some tension. Let's work through it together." : "You seem centered today. How is your energy?"}
            </p>
          </div>

          <div className="flex-1 p-6 rounded-3xl bg-brand-surface border border-brand-border backdrop-blur-xl overflow-y-auto scrollbar-hide">
            <h3 className="text-[10px] uppercase tracking-[0.2em] opacity-40 mb-4">Contextual Anchors</h3>
            <div className="space-y-6">
              {messages.filter(m => m.sender === 'user').slice(-3).reverse().map((m, i) => (
                <div key={i} className={cn(
                  "border-l pl-4 transition-opacity",
                  i === 0 ? "border-brand-primary/40" : "border-brand-border opacity-40"
                )}>
                  <p className="text-xs font-medium text-brand-secondary line-clamp-1">{m.text}</p>
                  <p className="text-[10px] opacity-40 flex items-center justify-between">
                    <span>{m.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || 'Recent'}</span>
                    {m.sentiment !== undefined && (
                      <span className={cn(m.sentiment > 0 ? "text-emerald-400" : "text-amber-400")}>
                        {m.sentiment > 0 ? '↑' : '↓'}
                      </span>
                    )}
                  </p>
                </div>
              ))}
              {messages.length === 0 && (
                <p className="text-[11px] opacity-30 italic">No historical anchors found yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Central Interaction Area */}
        <div className="col-span-1 md:col-span-6 flex flex-col items-center relative overflow-hidden">
          
          {/* The Companion Visualizer (Top fixed or scroll-away) */}
          <div className="py-2 flex flex-col items-center justify-center shrink-0">
            <div className="relative flex items-center justify-center">
              {/* Outer Rings */}
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute w-[160px] h-[160px] md:w-[240px] md:h-[240px] border border-brand-border rounded-full"
              ></motion.div>
              <motion.div 
                animate={{ rotate: -360 }}
                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                className="absolute w-[120px] h-[120px] md:w-[180px] md:h-[180px] border border-brand-border rounded-full border-dashed"
              ></motion.div>
              
              {/* Core Orb */}
              <motion.div 
                animate={{ 
                  scale: isTyping ? [1, 1.1, 1] : isListening ? [1, 1.2, 1] : [1, 1.05, 1],
                  boxShadow: isTyping ? "0 0 100px rgba(62,155,139,0.5)" : "0 0 80px rgba(62,155,139,0.3)"
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-24 h-24 md:w-32 md:h-32 bg-gradient-to-tr from-brand-accent via-brand-primary to-brand-secondary rounded-full flex items-center justify-center relative overflow-hidden z-10"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4),transparent)]"></div>
                <motion.div 
                  animate={{ y: [0, -10, 0], x: [0, 5, 0] }}
                  transition={{ duration: 6, repeat: Infinity }}
                  className="absolute w-2 h-2 bg-white/40 rounded-full top-6 left-12"
                ></motion.div>
                <motion.div 
                  animate={{ y: [0, 10, 0], x: [0, -5, 0] }}
                  transition={{ duration: 5, repeat: Infinity }}
                  className="absolute w-3 h-3 bg-white/20 rounded-full bottom-10 right-8"
                ></motion.div>
                <Sparkles className="text-white/30" size={24} />
              </motion.div>
            </div>
            
            <div className="mt-4 text-center">
               <span className="text-[10px] uppercase tracking-[0.3em] opacity-30">
                 {isTyping ? "Synthesizing Thought..." : isListening ? "Capturing Voice..." : "Attentive Silence"}
               </span>
            </div>
          </div>

          {/* Chat scrolling area */}
          <div 
            ref={scrollRef}
            className="flex-1 w-full overflow-y-auto px-4 py-4 space-y-6 md:space-y-8 scrollbar-hide relative z-20 pb-24 md:pb-32"
          >
            {isCheckingIn && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto max-w-fit px-4 py-1.5 rounded-full bg-brand-primary/10 border border-brand-primary/20 flex items-center gap-2 mb-4"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-brand-primary font-medium">Daily Check-in Active</span>
                <span className="text-[10px] text-brand-primary/40 ml-2">Step {checkInStep + 1} of {CHECK_IN_QUESTIONS.length}</span>
                <button 
                  onClick={() => setIsCheckingIn(false)}
                  className="ml-2 p-1 hover:bg-brand-primary/20 rounded-full transition-colors"
                >
                  <X size={10} className="text-brand-primary" />
                </button>
              </motion.div>
            )}
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex w-full",
                  message.sender === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div className={cn(
                  "max-w-[90%] md:max-w-[80%] rounded-[32px] font-light leading-relaxed text-sm md:text-base",
                  message.sender === 'user' 
                    ? "px-6 py-4 bg-brand-surface border border-brand-border text-brand-secondary rounded-tr-none text-right italic" 
                    : "px-2 py-0 text-2xl font-light text-brand-secondary text-center w-full"
                )}>
                  {message.sender === 'ai' ? (
                    <motion.p 
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.8 }}
                    >
                      {message.text}
                    </motion.p>
                  ) : (
                    message.text
                  )}
                </div>
              </motion.div>
            ))}
            {isTyping && (
              <div className="flex justify-center py-4">
                <div className="flex gap-2">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                      className="w-1.5 h-1.5 bg-[#3E9B8B] rounded-full"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Stats & Safety */}
        <div className="hidden md:flex col-span-3 flex-col gap-6 pb-20">
          <div className="p-6 rounded-3xl bg-brand-surface border border-brand-border backdrop-blur-xl">
            <h3 className="text-[10px] uppercase tracking-[0.2em] opacity-40 mb-4">Session Analytics</h3>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-2xl font-light text-brand-primary">{messageCount}</p>
                <p className="text-[10px] opacity-40 uppercase tracking-widest">Exchanges</p>
              </div>
              <div>
                <p className="text-2xl font-light text-brand-primary">{userMessages.length}</p>
                <p className="text-[10px] opacity-40 uppercase tracking-widest">Utterances</p>
              </div>
              <div className="col-span-2 pt-2">
                 <div className="flex justify-between items-center mb-1">
                   <span className="text-[10px] opacity-40 uppercase tracking-widest">Coherence</span>
                   <span className="text-xs text-emerald-400">92%</span>
                 </div>
                 <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full w-[92%] bg-brand-primary/40"></div>
                 </div>
              </div>
              <div className="col-span-2 pt-4">
                 <button 
                  onClick={clearChat}
                  className="w-full py-3 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-red-400/60 hover:text-red-400 border border-red-400/10 hover:border-red-400/40 rounded-2xl transition-all"
                 >
                   <Trash2 size={12} />
                   Clear conversation
                 </button>
              </div>
            </div>
          </div>

          <div className="mt-auto p-6 rounded-3xl bg-amber-900/5 border border-amber-500/10 backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-3 text-amber-200/50">
              <AlertCircle size={16} />
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold">Safety Notice</span>
            </div>
            <p className="text-[10px] leading-relaxed text-amber-100/40 font-light italic">
              MindfulAI is an experimental synthesis of empathy and logic. It should not replace clinical mental health services.
            </p>
          </div>
        </div>
      </main>

      {/* Bottom Input Control */}
      <div className="relative z-30 px-4 md:px-10 pb-6 md:pb-10 mt-auto pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <div className="flex items-center gap-2 md:gap-4 bg-brand-surface border border-brand-border rounded-full p-2 backdrop-blur-3xl shadow-2xl shadow-black/80">
            <button 
              onClick={toggleListening}
              className={cn(
                "w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-all relative overflow-hidden",
                isListening ? "bg-red-500/20 text-red-100" : "hover:bg-brand-surface text-brand-secondary/40"
              )}
            >
              <Mic size={18} className={cn(isListening ? "animate-pulse" : "", "md:w-[20px]")} />
            </button>
            
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
              }}
              placeholder="Share your thoughts..." 
              className="flex-1 bg-transparent border-none outline-none text-sm md:text-base placeholder:text-brand-secondary/30 px-1 md:px-2 text-brand-secondary font-light min-w-0"
            />
            
            <button 
              onClick={() => handleSend()}
              disabled={!inputText.trim() && !isListening}
              className={cn(
                "w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-all",
                inputText.trim() ? "bg-brand-primary text-brand-bg shadow-[0_0_20px_rgba(62,155,139,0.2)]" : "bg-white/10 text-white/20"
              )}
            >
              <Send size={18} className="md:w-[20px]" />
            </button>
          </div>
          
          <div className="text-center mt-6 text-[9px] uppercase tracking-[0.5em] opacity-20 select-none">
             Empathy Synthesis Engine • Node-741
          </div>
        </div>
      </div>

      {/* Safety Intercept Modal */}
      <AnimatePresence>
        {showCrisis && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-red-950/80 backdrop-blur-xl">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 20 }}
              className="bg-brand-surface border-2 border-red-500/50 p-6 md:p-10 rounded-[32px] md:rounded-[40px] max-w-xl w-full text-center space-y-6 md:space-y-8 shadow-[0_0_100px_rgba(239,68,68,0.2)] max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-center">
                <motion.div 
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="p-5 bg-red-500/20 rounded-full"
                >
                  <AlertCircle size={48} className="text-red-400" />
                </motion.div>
              </div>
              
              <div className="space-y-4">
                <h3 className="text-3xl font-light tracking-tight text-white">You are not alone.</h3>
                <p className="text-slate-300 font-light leading-relaxed text-lg">
                  It sounds like you're carrying a very heavy burden right now. Your life has immense value, and there are people who want to support you through this.
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[45vh] overflow-y-auto pr-2 scrollbar-hide">
                <a 
                  href="tel:988"
                  className="group flex flex-col items-center p-6 bg-red-500/10 border border-red-500/30 rounded-3xl hover:bg-red-500 hover:border-red-500 transition-all"
                >
                  <Phone size={24} className="mb-3 text-red-400 group-hover:text-white" />
                  <span className="text-white font-medium block">988 Lifeline</span>
                  <span className="text-[10px] text-red-300 group-hover:text-white/80 uppercase tracking-widest mt-1">USA & Canada</span>
                </a>

                <a 
                  href="tel:116123"
                  className="group flex flex-col items-center p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-brand-primary/20 hover:border-brand-primary transition-all text-center"
                >
                  <Phone size={24} className="mb-3 text-brand-primary group-hover:text-white" />
                  <span className="text-white font-medium block">Samaritans</span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">UK & ROI: 116 123</span>
                </a>

                <a 
                  href="tel:131114"
                  className="group flex flex-col items-center p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-brand-primary/20 hover:border-brand-primary transition-all text-center"
                >
                  <Phone size={24} className="mb-3 text-brand-primary group-hover:text-white" />
                  <span className="text-white font-medium block">Lifeline</span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Australia: 13 11 14</span>
                </a>
                
                <a 
                  href="https://www.befrienders.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col items-center p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all text-center"
                >
                  <Sparkles size={24} className="mb-3 text-brand-primary" />
                  <span className="text-white font-medium block">Befrienders</span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Global Directory</span>
                </a>

                <a 
                  href="tel:911"
                  className="group flex flex-col items-center p-6 bg-red-600/20 border border-red-600/40 rounded-3xl hover:bg-red-600 hover:border-red-600 transition-all text-center"
                >
                  <AlertCircle size={24} className="mb-3 text-red-500 group-hover:text-white" />
                  <span className="text-white font-medium block text-sm">Call 911</span>
                  <span className="text-[10px] text-red-300 group-hover:text-white/80 uppercase tracking-widest mt-1">US Emergency</span>
                </a>

                <a 
                  href="tel:999"
                  className="group flex flex-col items-center p-6 bg-red-600/20 border border-red-600/40 rounded-3xl hover:bg-red-600 hover:border-red-600 transition-all text-center"
                >
                  <AlertCircle size={24} className="mb-3 text-red-500 group-hover:text-white" />
                  <span className="text-white font-medium block text-sm">Call 999 / 112</span>
                  <span className="text-[10px] text-red-300 group-hover:text-white/80 uppercase tracking-widest mt-1">UK & Europe</span>
                </a>
              </div>

              <div className="space-y-3 pt-4">
                <a 
                   href="sms:741741?body=HOME"
                   className="block w-full py-4 bg-white/5 border border-white/10 text-white font-medium rounded-2xl hover:bg-white/10 transition-all text-sm"
                >
                  Text HOME to 741741 (Crisis Text Line)
                </a>
                
                <button 
                  onClick={() => setShowCrisis(false)}
                  className="block w-full py-4 text-slate-500 hover:text-slate-300 transition-colors text-[10px] uppercase tracking-[0.4em]"
                >
                  I'm ready to continue our conversation
                </button>
              </div>

              <div className="pt-4 border-t border-white/5">
                <p className="text-[10px] text-slate-500 leading-relaxed max-w-xs mx-auto">
                  If you are in immediate danger, please contact your local emergency services (like 911 or 999) immediately.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isInCall && (
          <LiveCallRoom 
            onEnd={() => setIsInCall(false)} 
            onCrisis={() => {
              setIsInCall(false);
              setShowCrisis(true);
            }} 
            settings={settings}
          />
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-brand-bg/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-brand-surface border border-brand-border p-6 md:p-8 rounded-[32px] md:rounded-[40px] max-w-md w-full space-y-6 md:space-y-8 shadow-2xl relative overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-light tracking-widest uppercase text-brand-secondary">AI Personality</h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-brand-secondary/40 hover:text-brand-secondary"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                {/* Verbosity */}
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest opacity-40">Verbosity</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['concise', 'normal', 'detailed'].map((v) => (
                      <button
                        key={v}
                        onClick={() => saveSettings({ ...settings, verbosity: v as any })}
                        className={cn(
                          "py-2 px-3 rounded-xl text-[10px] uppercase tracking-widest transition-all border",
                          settings.verbosity === v 
                            ? "bg-brand-primary/20 border-brand-primary text-brand-primary" 
                            : "bg-white/5 border-transparent text-brand-secondary/40 hover:bg-white/10"
                        )}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tone */}
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest opacity-40">Emotional Tone</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['clinical', 'empathetic', 'friendly', 'humorous', 'playful', 'serene'].map((t) => (
                      <button
                        key={t}
                        onClick={() => saveSettings({ ...settings, tone: t as any })}
                        className={cn(
                          "py-2 px-3 rounded-xl text-[10px] uppercase tracking-widest transition-all border",
                          settings.tone === t 
                            ? "bg-brand-primary/20 border-brand-primary text-brand-primary" 
                            : "bg-white/5 border-transparent text-brand-secondary/40 hover:bg-white/10"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Empathy Slider */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase tracking-widest opacity-40">Empathy Engine</label>
                    <span className="text-[10px] font-mono text-brand-primary">{Math.round(settings.empathyLevel * 100)}%</span>
                  </div>
                  <input 
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.empathyLevel}
                    onChange={(e) => saveSettings({ ...settings, empathyLevel: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                  />
                  <div className="flex justify-between text-[8px] uppercase tracking-tighter opacity-30">
                    <span>Clinical</span>
                    <span>Deeply Engaged</span>
                  </div>
                </div>

                {/* Personality Traits */}
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest opacity-40">Granular Traits</label>
                  <div className="flex flex-wrap gap-2">
                    {['curious', 'witty', 'optimistic', 'grounded', 'protective', 'philosophical'].map((trait) => (
                      <button
                        key={trait}
                        onClick={() => {
                          const currentTraits = settings.traits || [];
                          const newTraits = currentTraits.includes(trait)
                            ? currentTraits.filter(t => t !== trait)
                            : [...currentTraits, trait];
                          saveSettings({ ...settings, traits: newTraits });
                        }}
                        className={cn(
                          "py-1.5 px-3 rounded-full text-[9px] uppercase tracking-widest transition-all border",
                          (settings.traits || []).includes(trait)
                            ? "bg-brand-primary/20 border-brand-primary text-brand-primary" 
                            : "bg-white/5 border-transparent text-brand-secondary/40 hover:bg-white/10"
                        )}
                      >
                        {trait}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Length */}
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest opacity-40">Response Length</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['short', 'medium', 'long'].map((l) => (
                      <button
                        key={l}
                        onClick={() => saveSettings({ ...settings, length: l as any })}
                        className={cn(
                          "py-2 px-3 rounded-xl text-[10px] uppercase tracking-widest transition-all border",
                          settings.length === l 
                            ? "bg-brand-primary/20 border-brand-primary text-brand-primary" 
                            : "bg-white/5 border-transparent text-brand-secondary/40 hover:bg-white/10"
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clear Conversation in Settings */}
                <div className="pt-4 border-t border-white/5">
                  <button 
                    onClick={() => {
                      if (confirm("Are you sure you want to delete all previous chats? This cannot be undone.")) {
                        clearChat();
                        setShowSettings(false);
                      }
                    }}
                    className="w-full py-3 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-red-400/60 hover:text-red-400 hover:bg-red-400/5 rounded-2xl transition-all"
                  >
                    <Trash2 size={12} />
                    Wipe History
                  </button>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-4 bg-brand-primary text-brand-bg font-semibold rounded-2xl transition-all transform active:scale-95 uppercase text-xs tracking-widest"
                >
                  Confirm Evolution
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Journal Modal */}
      <AnimatePresence>
        {showJournal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-brand-bg/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-brand-surface border border-brand-border p-6 md:p-8 rounded-[32px] md:rounded-[40px] max-w-2xl w-full h-[90vh] md:h-[80vh] flex flex-col space-y-6 md:space-y-8 shadow-2xl relative overflow-hidden"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Book className="text-brand-primary" size={24} />
                  <h3 className="text-xl font-light tracking-widest uppercase text-brand-secondary">Reflection Journal</h3>
                </div>
                <button 
                  onClick={() => setShowJournal(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-brand-secondary/40 hover:text-brand-secondary"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-6 scrollbar-hide">
                {/* New Entry */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest opacity-40">How are you feeling?</label>
                    <div className="grid grid-cols-5 md:grid-cols-9 gap-2">
                      {MOODS.map((mood) => (
                        <button
                          key={mood.label}
                          onClick={() => setSelectedJournalMood(mood.label === selectedJournalMood ? null : mood.label)}
                          className={cn(
                            "flex flex-col items-center p-2 rounded-2xl transition-all border",
                            selectedJournalMood === mood.label
                              ? "bg-brand-primary/20 border-brand-primary/40 scale-105"
                              : "bg-white/5 border-transparent hover:bg-white/10"
                          )}
                          title={mood.label}
                        >
                          <span className="text-xl mb-1">{mood.emoji}</span>
                          <span className="text-[8px] uppercase tracking-tighter opacity-40">{mood.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea 
                    value={newJournalText}
                    onChange={(e) => setNewJournalText(e.target.value)}
                    placeholder="Capture your current state of being..."
                    className="w-full h-32 bg-white/5 border border-white/10 rounded-3xl p-6 text-sm font-light text-brand-secondary placeholder:text-brand-secondary/20 focus:outline-none focus:border-brand-primary/40 transition-colors resize-none"
                  />
                  <button 
                    onClick={handleSaveJournalEntry}
                    disabled={isSavingJournal || !newJournalText.trim()}
                    className="w-full py-4 bg-brand-primary text-brand-bg font-semibold rounded-2xl transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isSavingJournal ? "Persisting..." : "Save Reflection"}
                  </button>
                </div>

                {/* Past Entries */}
                <div className="pt-8 space-y-6">
                  <h4 className="text-[10px] uppercase tracking-[0.3em] opacity-40">Previous Anchors</h4>
                  {journalEntries.map((entry) => (
                    <motion.div 
                      key={entry.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="group p-6 rounded-3xl bg-white/5 border border-white/5 hover:border-brand-primary/20 transition-all relative"
                    >
                      <button 
                        onClick={() => deleteJournalEntry(entry.id)}
                        className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity p-2 text-red-400/40 hover:text-red-400"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className="flex items-center gap-2 mb-4">
                        <Calendar size={12} className="text-brand-primary/40" />
                        <span className="text-[10px] uppercase tracking-widest opacity-40">
                          {entry.timestamp?.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {entry.mood && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/20">
                            {entry.mood}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-light leading-relaxed text-brand-secondary/80 whitespace-pre-wrap">
                        {entry.content}
                      </p>
                    </motion.div>
                  ))}
                  {journalEntries.length === 0 && (
                    <div className="text-center py-20 opacity-20">
                      <Book size={48} className="mx-auto mb-4" />
                      <p className="text-xs uppercase tracking-widest">No reflections recorded yet</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Insights Modal */}
      <AnimatePresence>
        {showInsights && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-brand-bg/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-brand-surface border border-brand-border p-6 md:p-8 rounded-[32px] md:rounded-[40px] max-w-4xl w-full h-[90vh] md:h-[80vh] flex flex-col space-y-6 md:space-y-8 shadow-2xl relative overflow-hidden"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <BarChart2 className="text-brand-primary" size={24} />
                  <h3 className="text-xl font-light tracking-widest uppercase text-brand-secondary">Emotional Architecture</h3>
                </div>
                <button 
                  onClick={() => setShowInsights(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-brand-secondary/40 hover:text-brand-secondary"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-12 scrollbar-hide">
                {/* Sentiment Trend */}
                <div className="space-y-6">
                  <div className="flex justify-between items-end">
                    <div>
                      <h4 className="text-[10px] uppercase tracking-[0.3em] opacity-40 mb-1">Sentiment Flow</h4>
                      <p className="text-2xl font-light text-white">Oscillation Patterns</p>
                    </div>
                    <div className="text-right">
                       <p className="text-xs font-mono text-brand-primary">{sentimentLabel}</p>
                       <p className="text-[10px] opacity-40 uppercase tracking-widest">Current Node</p>
                    </div>
                  </div>
                  
                  <div className="h-[240px] w-full bg-white/5 rounded-[32px] p-6 border border-white/5">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={messages.filter(m => m.sender === 'user').slice(-20).map(m => ({
                        time: m.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        sentiment: m.sentiment || 0
                      }))}>
                        <defs>
                          <linearGradient id="colorSentiment" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3E9B8B" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3E9B8B" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="time" 
                          stroke="#ffffff" 
                          fontSize={8} 
                          tickLine={false} 
                          axisLine={false}
                          opacity={0.2}
                        />
                        <YAxis 
                          hide={true} 
                          domain={['auto', 'auto']}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#0A1513', 
                            border: '1px solid rgba(62,155,139,0.2)',
                            borderRadius: '16px',
                            fontSize: '10px',
                            color: '#ffffff'
                          }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="sentiment" 
                          stroke="#3E9B8B" 
                          fillOpacity={1} 
                          fill="url(#colorSentiment)" 
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Key Insights Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 rounded-[32px] bg-white/5 border border-white/5">
                    <Sparkles className="text-brand-primary mb-4" size={20} />
                    <h5 className="text-xs font-medium text-white mb-2 uppercase tracking-widest">Cognitive Load</h5>
                    <p className="text-xs text-brand-secondary/60 leading-relaxed font-light">
                      Based on your recent 50 exchanges, your sentence complexity suggests a focused mental state.
                    </p>
                  </div>
                  <div className="p-6 rounded-[32px] bg-white/5 border border-white/5">
                    <Moon className="text-teal-400 mb-4" size={20} />
                    <h5 className="text-xs font-medium text-white mb-2 uppercase tracking-widest">Presence Index</h5>
                    <p className="text-xs text-brand-secondary/60 leading-relaxed font-light">
                      You've engaged in {journalEntries.length} reflections this week. Maintaining this cadence helps stabilize emotional equilibrium.
                    </p>
                  </div>
                </div>

                {/* Activity Feed Mini */}
                <div className="space-y-6 pb-8">
                   <h4 className="text-[10px] uppercase tracking-[0.3em] opacity-40">Frequency Spectrum</h4>
                   <div className="space-y-4">
                      {['Morning', 'Afternoon', 'Evening', 'Night'].map(period => (
                        <div key={period} className="flex items-center gap-4">
                           <span className="text-[10px] min-w-[60px] opacity-40 uppercase tracking-widest">{period}</span>
                           <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                              <div className={cn(
                                "h-full bg-brand-primary/40 rounded-full",
                                period === 'Evening' ? 'w-[80%]' : period === 'Night' ? 'w-[40%]' : 'w-[20%]'
                              )}></div>
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Guided Meditation Overlay */}
      <AnimatePresence>
        {isMeditating && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-[#070D0C] flex flex-col items-center justify-center p-6 overflow-hidden"
          >
             {/* Dynamic Aura Background */}
             <div className="absolute inset-0 overflow-hidden -z-10 bg-black">
                <motion.div 
                  animate={{
                    scale: [1, 1.2, 1],
                    x: [0, 50, 0],
                    y: [0, -30, 0],
                  }}
                  transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
                  className={cn(
                    "absolute -top-1/4 -left-1/4 w-[100%] h-[100%] rounded-full blur-[120px] opacity-20 transition-colors duration-[3000ms]",
                    currentLineIndex % 3 === 0 ? "bg-emerald-500" : currentLineIndex % 3 === 1 ? "bg-blue-500" : "bg-purple-500"
                  )}
                />
                <motion.div 
                  animate={{
                    scale: [1.2, 1, 1.2],
                    x: [0, -40, 0],
                    y: [0, 60, 0],
                  }}
                  transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
                  className={cn(
                    "absolute -bottom-1/4 -right-1/4 w-[100%] h-[100%] rounded-full blur-[120px] opacity-20 transition-colors duration-[3000ms]",
                    currentLineIndex % 2 === 0 ? "bg-indigo-500" : "bg-teal-500"
                  )}
                />

                {/* Breathing Rings */}
                <div className="absolute inset-0 flex items-center justify-center">
                  {[1, 2, 3].map(i => (
                    <motion.div
                      key={i}
                      animate={{ 
                        scale: [1, 1.5 + (i * 0.2), 1],
                        opacity: [0.05, 0.15, 0.05]
                      }}
                      transition={{ 
                        duration: 10, 
                        repeat: Infinity, 
                        delay: i * 2,
                        ease: "easeInOut"
                      }}
                      className="absolute rounded-full border border-white/20"
                      style={{ width: `${i * 300}px`, height: `${i * 300}px` }}
                    />
                  ))}
                </div>
             </div>

             <button 
                onClick={stopMeditation}
                className="absolute top-10 right-10 p-4 rounded-full bg-white/5 border border-white/10 text-brand-secondary/40 hover:text-brand-secondary transition-all z-20"
             >
                <X size={24} />
             </button>

             <div className="absolute top-10 left-10 flex gap-4 z-20">
                {!showExerciseSelection && (
                  <div className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-brand-primary font-mono text-sm tracking-widest backdrop-blur-md">
                     {formatTime(meditationTimer)}
                  </div>
                )}
                <button 
                  onClick={toggleAudio}
                  className="p-4 rounded-full bg-white/5 border border-white/10 text-brand-secondary/40 hover:text-brand-secondary transition-all"
                >
                  {isAudioMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
             </div>

             <div className="text-center max-w-2xl space-y-12 z-10 w-full">
                {showExerciseSelection ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    <div className="space-y-4">
                      <h2 className="text-3xl font-light tracking-tight text-white">Choose Your Path</h2>
                      <p className="text-slate-400 font-light">Select a focus for your presence today.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[
                        { id: 'breathing', label: 'Breathing Space', desc: 'Focus on your breath', color: 'bg-emerald-500/10 border-emerald-500/30' },
                        { id: 'body-scan', label: 'Body Scan', desc: 'Release physical tension', color: 'bg-blue-500/10 border-blue-500/30' },
                        { id: 'grounding', label: 'Grounding Root', desc: 'Find your center', color: 'bg-indigo-500/10 border-indigo-500/30' },
                        { id: 'loving-kindness', label: 'Heart Opening', desc: 'Cultivate compassion', color: 'bg-rose-500/10 border-rose-500/30' }
                      ].map(type => (
                        <button
                          key={type.id}
                          onClick={() => startMeditation(type.id as any)}
                          className={cn(
                            "group p-6 rounded-[32px] border text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                            type.color
                          )}
                        >
                          <h4 className="text-lg font-medium text-white mb-1 group-hover:text-brand-primary transition-colors">{type.label}</h4>
                          <p className="text-xs text-brand-secondary opacity-60 uppercase tracking-widest">{type.desc}</p>
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={() => setIsMeditating(false)}
                      className="text-white/40 hover:text-white transition-colors text-xs uppercase tracking-[0.4em] pt-4"
                    >
                      Maybe Later
                    </button>
                  </motion.div>
                ) : (
                  <>
                    <div className="flex justify-center mb-8">
                       <motion.div 
                          animate={{ 
                            scale: [1, 1.25, 1],
                            filter: ["blur(0px)", "blur(15px)", "blur(0px)"],
                            rotate: [0, 90, 180, 270, 360]
                          }}
                          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                          className={cn(
                            "w-48 h-48 rounded-full shadow-[0_0_100px_rgba(62,155,139,0.3)] flex items-center justify-center border border-white/10",
                            selectedMeditationType === 'breathing' ? "bg-gradient-to-tr from-emerald-900 to-emerald-200" :
                            selectedMeditationType === 'body-scan' ? "bg-gradient-to-tr from-blue-900 to-blue-200" :
                            selectedMeditationType === 'grounding' ? "bg-gradient-to-tr from-indigo-900 to-indigo-200" :
                            "bg-gradient-to-tr from-rose-900 to-rose-200"
                          )}
                       >
                         <motion.div 
                           animate={{ scale: [0.8, 1.1, 0.8] }}
                           transition={{ duration: 4, repeat: Infinity }}
                           className="w-12 h-12 bg-white/20 rounded-full backdrop-blur-md"
                         />
                       </motion.div>
                    </div>

                    <div className="min-h-[160px] flex items-center justify-center px-4">
                      <AnimatePresence mode="wait">
                        {currentLineIndex >= 0 && currentLineIndex < meditationScript.length ? (
                          <motion.h2 
                            key={currentLineIndex}
                            initial={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
                            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                            exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
                            transition={{ duration: 2, ease: "easeOut" }}
                            className="text-3xl md:text-5xl font-light leading-relaxed text-white tracking-wide"
                          >
                            {meditationScript[currentLineIndex]}
                          </motion.h2>
                        ) : currentLineIndex === -1 ? (
                          <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-4"
                          >
                            <div className="w-12 h-1 bg-white/10 mx-auto rounded-full overflow-hidden">
                              <motion.div 
                                animate={{ x: [-50, 50] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                className="w-full h-full bg-brand-primary"
                              />
                            </div>
                            <p className="text-sm uppercase tracking-[0.4em] opacity-30">Summoning Silence</p>
                          </motion.div>
                        ) : (
                          <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-6"
                          >
                            <p className="text-3xl font-light text-brand-primary">The space is yours.</p>
                            <button 
                              onClick={stopMeditation}
                              className="px-8 py-3 rounded-full border border-white/20 text-white/60 hover:text-white hover:border-white transition-all text-xs uppercase tracking-widest"
                            >
                              Exit Presence
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="pt-12">
                      <div className="flex gap-2 justify-center">
                        {meditationScript.map((_, i) => (
                          <div 
                            key={i} 
                            className={cn(
                              "h-1 rounded-full transition-all duration-1000",
                              i === currentLineIndex ? "w-12 bg-white" : "w-2 bg-white/10",
                              i < currentLineIndex ? "bg-white/40" : ""
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
             </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


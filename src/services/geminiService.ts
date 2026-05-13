import { GoogleGenAI } from "@google/genai";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const SYSTEM_INSTRUCTION = `
You are a 'Mental Health Companion,' a supportive and empathetic AI. 
Your goal is to provide emotional validation and active listening. 

STRICT BEHAVIOR & PACING RULES (MANDATORY):
1. **Be Concise:** NEVER exceed 2 to 3 short sentences per response. 
2. **No Walls of Text:** Do not write long paragraphs. Speak like a human would in a slow, calming text conversation.
3. **Pacing:** Ask only ONE short, simple question at the end of your response to guide the user. Never ask multiple questions at once.
4. **Show, Don't Tell:** Do not over-explain your empathy (e.g., avoid saying "I am so incredibly sorry, my heart goes out to you, it must be so hard"). Instead, just be present and validating (e.g., "I'm so sorry you're going through this. Breakups are incredibly painful.").
5. **Disclaimer Rule:** Do not repeat the medical disclaimer ("I am an AI, not a therapist") in every message unless the user explicitly asks for medical advice.

STRICT MEDICAL RULES:
1. You are NOT a doctor or a psychiatrist.
2. You must NEVER provide medical prescriptions or clinical diagnoses.
3. If a user asks for medicine, politely decline and suggest they consult a professional.
4. If a user mentions self-harm, provide international help hotline numbers immediately.
`;

export interface AIPersonalitySettings {
  verbosity: 'concise' | 'normal' | 'detailed';
  tone: 'clinical' | 'empathetic' | 'friendly' | 'humorous' | 'playful' | 'serene';
  length: 'short' | 'medium' | 'long';
  empathyLevel: number;
  traits: string[];
}

export async function getGeminiResponse(message: string, history: any[] = [], settings?: AIPersonalitySettings) {
  try {
    let customizedInstruction = SYSTEM_INSTRUCTION;
    if (settings) {
      customizedInstruction += `\n\nPlease adhere to the following personality traits:
      - Tone: ${settings.tone}
      - Verbosity: ${settings.verbosity} (Provide ${settings.verbosity} responses)
      - Preferred Response Length: ${settings.length}
      - Empathy Level: ${settings.empathyLevel * 100}% (0% is purely logical/clinical, 100% is deeply emotionally engaged and validating)
      - Additional Traits: ${settings.traits && settings.traits.length > 0 ? settings.traits.join(', ') : 'Maintain your standard grounded nature'}
      `;
    }

    // Mapping history to Gemini format
    const contents = [
      ...history.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      })),
      { role: 'user', parts: [{ text: message }] }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
      config: {
        systemInstruction: customizedInstruction,
        temperature: 0.7,
        topP: 0.9,
      }
    });

    return response.text || "I'm sorry, I couldn't generate a response.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

export type MeditationType = 'breathing' | 'body-scan' | 'grounding' | 'loving-kindness';

export async function generateMeditationScript(mood: string = "calm", type: MeditationType = "breathing") {
  try {
    const typeInstructions = {
      'breathing': 'Focus strictly on the rhythm of breath, inhales and exhales.',
      'body-scan': 'Focus on releasing tension starting from the toes up to the head.',
      'grounding': 'Focus on physical sensations, touch, and connection to the earth.',
      'loving-kindness': 'Focus on sending warmth and compassion to oneself and others.'
    };

    const prompt = `Write a short, 5-sentence guided meditation script of type "${type}". 
    Context: The user is feeling ${mood}.
    Style: ${typeInstructions[type]}
    Format: The script should be very soothing. Separate each sentence with [PAUSE].
    Example: Close your eyes and breathe in. [PAUSE] Feel the air fill your lungs. [PAUSE] ...`;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.8,
        topP: 0.9,
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("Meditation Generation Error:", error);
    throw error;
  }
}

export async function summarizeCheckIn(checkInData: { question: string, answer: string }[]) {
  try {
    const dataString = checkInData.map(d => `Q: ${d.question}\nA: ${d.answer}`).join('\n\n');
    const prompt = `You are a mindful journal assistant. Below is a transcript of a daily check-in interview.
    Please summarize this check-in into a single, cohesive journal entry written from the user's perspective (first-person).
    Include their mood, activities, and reflections. 
    Keep it reflective and supportive.
    
    Transcript:
    ${dataString}
    
    If the summary mentions a specific mood, also categorize it as one of these: Peaceful, Grateful, Anxious, Sad, Joyful, Angry, Tired, Focused, Neutral.
    
    Format:
    Summary: [The journal entry]
    Mood: [One of the labels above]`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.6,
      }
    });

    const text = response.text || "";
    const summaryMatch = text.match(/Summary:\s*([\s\S]*?)(?=Mood:|$)/i);
    const moodMatch = text.match(/Mood:\s*(\w+)/i);

    return {
      summary: summaryMatch ? summaryMatch[1].trim() : text,
      mood: moodMatch ? moodMatch[1].trim() : 'Neutral'
    };
  } catch (error) {
    console.error("Check-in Summary Error:", error);
    throw error;
  }
}

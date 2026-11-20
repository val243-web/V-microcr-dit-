import React, { useEffect, useRef, useState } from 'react';
import { Headphones, Mic, Send, ShieldAlert, Square, Volume2 } from 'lucide-react';
import { apiRequest } from '../api/client';

interface MessageItem {
  id: string;
  sender: 'USER' | 'ASSISTANT';
  content: string;
  citations_json?: string | null;
  created_at: string;
}

const QUICK_PROMPTS = [
  'Comment fonctionne l’épargne par objectifs ?',
  'Comment est calculé mon score de solvabilité ?',
  'Pourquoi les paiements Mobile Money sont-ils en simulation ?',
  'Comment retirer mon consentement biométrique ?',
];

export function AssistantView() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    apiRequest<{ conversationId: string | null; messages: MessageItem[] }>('/assistant/conversations')
      .then((res) => {
        setConversationId(res.conversationId);
        setMessages(res.messages);
      })
      .catch(() => {});
  }, []);

  async function sendMessage(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;
    setError(null);
    setLoading(true);
    setInput('');

    const tempUserMsg: MessageItem = {
      id: `tmp_${Date.now()}`,
      sender: 'USER',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await apiRequest<{
        conversationId: string;
        reply: string;
        citations: Array<{ id: string; title: string }>;
      }>('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ message: trimmed, conversationId }),
      });

      setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          sender: 'ASSISTANT',
          content: res.reply,
          citations_json: JSON.stringify(res.citations),
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur Assistant V-Micro');
    } finally {
      setLoading(false);
    }
  }

  async function startVoiceInput() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = String(reader.result || '').split(',')[1];
          if (!base64) return;
          setLoading(true);
          try {
            const res = await apiRequest<{ transcript: string }>('/assistant/transcribe', {
              method: 'POST',
              body: JSON.stringify({ audioBase64: base64, mimeType: blob.type || 'audio/webm' }),
            });
            setInput(res.transcript);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erreur transcription vocale');
          } finally {
            setLoading(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone non disponible dans ce navigateur.');
    }
  }

  function stopVoiceInput() {
    if (recorderRef.current && recording) {
      recorderRef.current.stop();
      setRecording(false);
    }
  }

  async function speakMessage(msg: MessageItem) {
    setError(null);
    setSpeakingId(msg.id);
    try {
      const res = await apiRequest<{ audioBase64: string; mimeType: string }>('/assistant/tts', {
        method: 'POST',
        body: JSON.stringify({ text: msg.content }),
      });
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
      audio.onended = () => setSpeakingId(null);
      await audio.play();
    } catch (err) {
      setSpeakingId(null);
      setError(err instanceof Error ? err.message : 'Erreur synthèse vocale');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-[#111111]">Assistant V-Micro (Texte & Voix)</h2>
          <p className="text-sm text-[#52525B]">
            Éducation financière, explication des échéanciers et dictée/lecture vocale Gemini
          </p>
        </div>
        <a
          href="mailto:support@vmicro.cd"
          className="min-h-[40px] px-3.5 border border-[#E5E7EB] hover:border-[#4F0000] rounded-lg text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap self-start"
        >
          <Headphones className="w-4 h-4 text-[#4F0000]" />
          Contacter le support humain
        </a>
      </div>

      {/* Garde-fou explicite */}
      <div className="p-3.5 border border-[#87CEEB] bg-[#87CEEB]/15 rounded-xl flex items-start gap-2.5 text-xs text-[#111111]">
        <ShieldAlert className="w-4 h-4 text-[#4F0000] shrink-0 mt-0.5" />
        <p>
          L’Assistant V-Micro ne reçoit jamais vos mots de passe, pièces d’identité ou données biométriques. Il ne peut ni approuver un crédit, ni modifier un solde, ni exécuter un paiement.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-[#4F0000] bg-[#4F0000]/10 text-xs text-[#4F0000]">
          {error}
        </div>
      )}

      {/* Fenêtre de conversation */}
      <div className="border border-[#E5E7EB] rounded-xl bg-white flex flex-col h-[460px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="py-8 space-y-4">
              <p className="text-sm text-[#52525B]">
                Posez une question à l’écrit ou au microphone sur votre épargne, les demandes de crédit, la vérification Halisi ou Mobile Money RDC :
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    className="p-3 text-left text-xs border border-[#E5E7EB] rounded-lg hover:border-[#4F0000] hover:bg-[#F8F8F9] transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const citations: Array<{ id: string; title: string }> = m.citations_json
                ? JSON.parse(m.citations_json)
                : [];
              const isUser = m.sender === 'USER';
              return (
                <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-[#4F0000] text-white'
                        : 'bg-[#F8F8F9] border border-[#E5E7EB] text-[#111111]'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {!isUser && (
                      <div className="mt-2 pt-2 border-t border-[#E5E7EB] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#52525B]">
                        <span>
                          {citations.length > 0 ? `Sources : ${citations.map((c) => c.title).join(' · ')}` : 'Assistant V-Micro'}
                        </span>
                        <button
                          type="button"
                          onClick={() => speakMessage(m)}
                          disabled={speakingId === m.id}
                          className="inline-flex items-center gap-1 text-[#4F0000] font-medium hover:underline cursor-pointer"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          {speakingId === m.id ? 'Lecture...' : 'Écouter'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {loading && <div className="text-xs text-[#52525B]">Traitement Gemini en cours...</div>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="p-3 border-t border-[#E5E7EB] flex items-center gap-2 bg-white rounded-b-xl"
        >
          <button
            type="button"
            onClick={recording ? stopVoiceInput : startVoiceInput}
            title={recording ? 'Arrêter la dictée' : 'Dicter au microphone'}
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border cursor-pointer ${
              recording ? 'border-[#4F0000] bg-[#4F0000]/10 text-[#4F0000]' : 'border-[#E5E7EB] text-[#111111]'
            }`}
          >
            {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Posez votre question ou utilisez le micro..."
            className="flex-1 min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#4F0000]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="min-h-[44px] px-4 bg-[#4F0000] text-white text-sm font-medium rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );
}

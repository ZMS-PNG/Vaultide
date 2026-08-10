'use client';

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Eraser,
  History,
  Lightbulb,
  Minimize2,
  PencilLine,
  Plus,
  RotateCcw,
  StickyNote,
} from 'lucide-react';
import { WhiteboardCanvas } from './whiteboard-canvas';
import type { WhiteboardCanvasHandle } from './whiteboard-canvas';
import { WhiteboardHistory } from './whiteboard-history';
import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createStageAPI } from '@/lib/api/stage-api';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  buildStudyFrameElements,
  upsertStudyNoteElements,
  type StudyNoteKind,
} from '@/lib/whiteboard/study-board';
import {
  createBrowserLearningEventId,
  recordClassroomLearningEvents,
} from '@/lib/learning/client/learning-events';

interface WhiteboardProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Whiteboard component
 */
export function Whiteboard({ isOpen, onClose }: WhiteboardProps) {
  const { t } = useI18n();
  const stage = useStageStore.use.stage();
  const isClearing = useCanvasStore.use.whiteboardClearing();
  const clearingRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [noteKind, setNoteKind] = useState<StudyNoteKind>('understanding');
  const [noteText, setNoteText] = useState('');
  const [viewModified, setViewModified] = useState(false);
  const canvasRef = useRef<WhiteboardCanvasHandle>(null);
  const snapshotCount = useWhiteboardHistoryStore((s) => s.snapshots.length);

  // Get element count for indicator
  const whiteboard = stage?.whiteboard?.[0];
  const elementCount = whiteboard?.elements?.length || 0;
  const currentScene = useStageStore((state) =>
    state.scenes.find((scene) => scene.id === state.currentSceneId),
  );
  const hasStudyFrame = !!whiteboard?.elements?.some(
    (element) => element.id === 'learner-frame-title',
  );

  const stageAPI = createStageAPI(useStageStore);

  const handleClear = async () => {
    if (!whiteboard || elementCount === 0 || clearingRef.current) return;
    clearingRef.current = true;

    // Save snapshot before clearing
    if (whiteboard.elements && whiteboard.elements.length > 0) {
      useWhiteboardHistoryStore.getState().pushSnapshot(whiteboard.elements);
    }

    // Trigger cascade exit animation
    useCanvasStore.getState().setWhiteboardClearing(true);

    // Wait for cascade: base 380ms + 55ms per element, capped at 1400ms
    const animMs = Math.min(380 + elementCount * 55, 1400);
    await new Promise((resolve) => setTimeout(resolve, animMs));

    // Actually remove elements
    const result = stageAPI.whiteboard.delete(whiteboard.id);
    useCanvasStore.getState().setWhiteboardClearing(false);
    clearingRef.current = false;

    if (result.success) {
      toast.success(t('whiteboard.clearSuccess'));
    } else {
      toast.error(t('whiteboard.clearError') + result.error);
    }
  };

  const saveWhiteboard = () => {
    void useStageStore
      .getState()
      .saveToStorage()
      .catch(() => toast.error(t('whiteboard.saveError')));
  };

  const handleCreateStudyFrame = () => {
    const result = stageAPI.whiteboard.get();
    if (!result.success || !result.data || result.data.elements.length > 0) return;

    const firstSpeech = currentScene?.actions?.find((action) => action.type === 'speech');
    const coreExcerpt =
      stage?.learningContext?.goal ||
      currentScene?.title ||
      (firstSpeech?.type === 'speech' ? firstSpeech.text : stage?.name || '');
    const elements = buildStudyFrameElements({
      title: currentScene?.title || stage?.name || t('whiteboard.title'),
      coreExcerpt,
      labels: {
        core: t('whiteboard.frameCore'),
        explain: t('whiteboard.frameExplain'),
        explainHint: t('whiteboard.frameExplainHint'),
        question: t('whiteboard.frameQuestion'),
        questionHint: t('whiteboard.frameQuestionHint'),
      },
    });

    const update = stageAPI.whiteboard.update({ elements }, result.data.id);
    if (!update.success) {
      toast.error(t('whiteboard.saveError'));
      return;
    }
    saveWhiteboard();
    toast.success(t('whiteboard.frameCreated'));
  };

  const handleAddNote = () => {
    const note = noteText.trim();
    if (!note) return;
    const result = stageAPI.whiteboard.get();
    if (!result.success || !result.data) return;

    if (result.data.elements.length > 0) {
      useWhiteboardHistoryStore.getState().pushSnapshot(result.data.elements);
    }
    const label =
      noteKind === 'understanding'
        ? t('whiteboard.noteUnderstanding')
        : noteKind === 'question'
          ? t('whiteboard.noteQuestion')
          : t('whiteboard.noteConnection');
    const elements = upsertStudyNoteElements(result.data.elements, { kind: noteKind, label, note });
    const update = stageAPI.whiteboard.update({ elements }, result.data.id);
    if (!update.success) {
      toast.error(t('whiteboard.saveError'));
      return;
    }
    setNoteText('');
    saveWhiteboard();
    if (stage?.id && currentScene?.id) {
      void recordClassroomLearningEvents(stage.id, [
        {
          eventType: 'whiteboardNoteAdded',
          clientEventId: createBrowserLearningEventId('whiteboard-note'),
          occurredAt: new Date().toISOString(),
          payload: {
            sceneId: currentScene.id,
            noteKind,
            characterCount: note.length,
          },
        },
      ]).catch(() => undefined);
    }
    toast.success(t('whiteboard.noteAdded'));
  };

  return (
    <>
      {/* Main Whiteboard Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              transition: {
                type: 'spring',
                stiffness: 120,
                damping: 18,
                mass: 1.2,
              },
            }}
            exit={{
              opacity: 0,
              scale: 0.95,
              y: 16,
              transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
            }}
            className="absolute inset-4 pointer-events-auto bg-white/95 dark:bg-gray-800/95 backdrop-blur-2xl rounded-3xl shadow-[0_32px_80px_-20px_rgba(0,0,0,0.25)] border-2 border-purple-200/60 dark:border-purple-700/60 flex flex-col overflow-hidden z-[120] ring-4 ring-purple-100/40 dark:ring-purple-800/40"
          >
            {/* Header */}
            <div className="h-14 px-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0 bg-white/50 dark:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <PencilLine className="w-4 h-4" />
                </div>
                <span className="font-bold text-gray-800 dark:text-gray-200 tracking-tight">
                  {t('whiteboard.title')}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  onClick={handleCreateStudyFrame}
                  disabled={elementCount > 0 || hasStudyFrame}
                  whileTap={{ scale: 0.9 }}
                  className="p-2 text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors disabled:opacity-35 disabled:pointer-events-none"
                  title={t('whiteboard.createStudyFrame')}
                  aria-label={t('whiteboard.createStudyFrame')}
                >
                  <Lightbulb className="w-4 h-4" />
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => setNoteComposerOpen((open) => !open)}
                  whileTap={{ scale: 0.9 }}
                  className="p-2 text-gray-400 dark:text-gray-500 hover:text-sky-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-lg transition-colors"
                  title={t('whiteboard.addStudyNote')}
                  aria-label={t('whiteboard.addStudyNote')}
                >
                  <StickyNote className="w-4 h-4" />
                </motion.button>
                <AnimatePresence>
                  {viewModified && (
                    <motion.button
                      type="button"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => canvasRef.current?.resetView()}
                      whileTap={{ scale: 0.9 }}
                      className="p-2 text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors"
                      title={t('whiteboard.resetView')}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </motion.button>
                  )}
                </AnimatePresence>
                <motion.button
                  type="button"
                  onClick={handleClear}
                  disabled={isClearing || elementCount === 0}
                  whileTap={{ scale: 0.9 }}
                  className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  title={t('whiteboard.clear')}
                >
                  <motion.div
                    animate={isClearing ? { rotate: [0, -15, 15, -10, 10, 0] } : { rotate: 0 }}
                    transition={
                      isClearing ? { duration: 0.5, ease: 'easeInOut' } : { duration: 0.2 }
                    }
                  >
                    <Eraser className="w-4 h-4" />
                  </motion.div>
                </motion.button>
                {/* History button + popover wrapper */}
                <div className="relative">
                  <motion.button
                    type="button"
                    onClick={() => setHistoryOpen(!historyOpen)}
                    whileTap={{ scale: 0.9 }}
                    className="relative p-2 text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors"
                    title={t('whiteboard.history')}
                  >
                    <History className="w-4 h-4" />
                    {snapshotCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {snapshotCount}
                      </span>
                    )}
                  </motion.button>
                  <WhiteboardHistory isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
                </div>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title={t('whiteboard.minimize')}
                >
                  <Minimize2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {noteComposerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  className="absolute left-3 right-3 top-16 z-[140] rounded-2xl border border-slate-200 bg-white/98 p-4 shadow-2xl backdrop-blur sm:left-auto sm:w-80 dark:border-slate-700 dark:bg-slate-900/98"
                >
                  <div className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t('whiteboard.addStudyNote')}
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {(['understanding', 'question', 'connection'] as const).map((kind) => {
                      const label =
                        kind === 'understanding'
                          ? t('whiteboard.noteUnderstanding')
                          : kind === 'question'
                            ? t('whiteboard.noteQuestion')
                            : t('whiteboard.noteConnection');
                      return (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setNoteKind(kind)}
                          className={`rounded-full px-2.5 py-1 text-xs transition ${
                            noteKind === kind
                              ? 'bg-violet-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <textarea
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    placeholder={t('whiteboard.notePlaceholder')}
                    rows={4}
                    maxLength={220}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-violet-900/40"
                  />
                  <button
                    type="button"
                    disabled={!noteText.trim()}
                    onClick={handleAddNote}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" /> {t('whiteboard.addToBoard')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Whiteboard Content Area */}
            <div className="flex-1 relative bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#374151_1px,transparent_1px)] [background-size:24px_24px] overflow-hidden">
              <WhiteboardCanvas ref={canvasRef} onViewModifiedChange={setViewModified} />
              {elementCount === 0 && !isClearing && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-5">
                  <div className="pointer-events-auto max-w-md rounded-2xl border border-violet-100 bg-white/95 p-5 text-center shadow-xl backdrop-blur dark:border-violet-900 dark:bg-slate-900/95">
                    <Lightbulb className="mx-auto h-7 w-7 text-amber-500" />
                    <h3 className="mt-2 text-base font-semibold text-slate-800 dark:text-slate-100">
                      {t('whiteboard.studyEmptyTitle')}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {t('whiteboard.studyEmptyDescription')}
                    </p>
                    <button
                      type="button"
                      onClick={handleCreateStudyFrame}
                      className="mt-4 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
                    >
                      {t('whiteboard.createStudyFrame')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

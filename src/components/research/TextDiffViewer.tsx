'use client';
import { useMemo } from 'react';
import { diff_match_patch } from 'diff-match-patch';

interface TextDiffViewerProps {
  oldText: string;
  newText: string;
  className?: string;
}

export function TextDiffViewer({ oldText, newText, className = '' }: TextDiffViewerProps) {
  const diffs = useMemo(() => {
    const dmp = new diff_match_patch();
    const diff = dmp.diff_main(oldText, newText);
    dmp.diff_cleanupSemantic(diff);
    return diff;
  }, [oldText, newText]);

  return (
    <div className={`font-sans leading-relaxed text-sm p-4 bg-white border border-gray-200 rounded-lg shadow-sm whitespace-pre-wrap dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 ${className}`}>
      {diffs.map((part, index) => {
        const [operation, text] = part;

        // operation: -1 is delete, 1 is insert, 0 is equal
        if (operation === -1) {
          return (
            <del
              key={index}
              className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 no-underline decoration-red-400 px-1 py-0.5 rounded-sm mx-0.5 inline"
            >
              <span className="line-through">{text}</span>
            </del>
          );
        }

        if (operation === 1) {
          return (
            <ins
              key={index}
              className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 no-underline px-1 py-0.5 rounded-sm mx-0.5 inline"
            >
              {text}
            </ins>
          );
        }

        return <span key={index}>{text}</span>;
      })}
    </div>
  );
}

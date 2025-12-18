"use client"

import { useState, useEffect } from "react"
import { Hash, X, Plus } from "lucide-react"
import { generateHashtags } from "@/src/lib/meta"

interface HashtagPickerProps {
  caption: string
  onHashtagsChange: (hashtags: string[]) => void
  selectedHashtags?: string[]
}

export function HashtagPicker({ caption, onHashtagsChange, selectedHashtags = [] }: HashtagPickerProps) {
  const [suggestedHashtags, setSuggestedHashtags] = useState<string[]>([])
  const [customHashtag, setCustomHashtag] = useState("")
  const [selected, setSelected] = useState<string[]>(selectedHashtags)

  useEffect(() => {
    const loadHashtags = async () => {
      const hashtags = await generateHashtags(caption)
      setSuggestedHashtags(hashtags)
    }
    if (caption) {
      loadHashtags()
    }
  }, [caption])

  const toggleHashtag = (hashtag: string) => {
    const newSelected = selected.includes(hashtag) ? selected.filter((h) => h !== hashtag) : [...selected, hashtag]
    setSelected(newSelected)
    onHashtagsChange(newSelected)
  }

  const addCustomHashtag = () => {
    if (customHashtag && !customHashtag.startsWith("#")) {
      const hashtag = `#${customHashtag}`
      if (!selected.includes(hashtag)) {
        const newSelected = [...selected, hashtag]
        setSelected(newSelected)
        onHashtagsChange(newSelected)
      }
      setCustomHashtag("")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-pink-400" />
          <h3 className="text-sm font-medium text-white">Hashtags ({selected.length}/30)</h3>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={customHashtag}
          onChange={(e) => setCustomHashtag(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
          onKeyPress={(e) => e.key === "Enter" && addCustomHashtag()}
          placeholder="Add custom hashtag"
          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
        />
        <button
          onClick={addCustomHashtag}
          className="px-3 py-2 bg-pink-500 hover:bg-pink-600 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 text-white" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 bg-white/5 rounded-lg">
        {selected.map((hashtag) => (
          <button
            key={hashtag}
            onClick={() => toggleHashtag(hashtag)}
            className="flex items-center gap-1 px-3 py-1.5 bg-pink-500 rounded-full text-white text-sm hover:bg-pink-600 transition-colors"
          >
            <span>{hashtag}</span>
            <X className="w-3 h-3" />
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-white/60">Suggested hashtags:</p>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
          {suggestedHashtags
            .filter((h) => !selected.includes(h))
            .map((hashtag) => (
              <button
                key={hashtag}
                onClick={() => toggleHashtag(hashtag)}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 text-sm transition-colors"
              >
                {hashtag}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

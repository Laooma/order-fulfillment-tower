import { useEffect, useState } from 'react'
import { usePetStore, type PetInfo } from '../stores/petStore'
import PetRenderer from './PetRenderer'

interface PetSelectorProps {
  open: boolean
  onClose: () => void
}

export default function PetSelector({ open, onClose }: PetSelectorProps) {
  const { pets, adoptedId, loading, loadPets, adopt, abandon } = usePetStore()
  const [selectedId, setSelectedId] = useState<string | null>(adoptedId)

  useEffect(() => {
    if (open) {
      loadPets()
      setSelectedId(adoptedId)
    }
  }, [open, loadPets, adoptedId])

  if (!open) return null

  const handleConfirm = () => {
    if (selectedId) {
      adopt(selectedId)
    } else {
      abandon()
    }
    onClose()
  }

  return (
    <div className="pet-selector-overlay" onClick={onClose}>
      <div className="pet-selector" onClick={(e) => e.stopPropagation()}>
        <div className="pet-selector-header">
          <span className="pet-selector-title">选择你的桌面宠物</span>
          <button className="pet-selector-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1.5 1.5l11 11m-11 0l11-11" />
            </svg>
          </button>
        </div>

        <div className="pet-selector-body">
          {loading ? (
            <div className="pet-selector-loading">加载宠物中...</div>
          ) : pets.length === 0 ? (
            <div className="pet-selector-loading">暂无可用宠物</div>
          ) : (
            <div className="pet-selector-grid">
              {pets.map((pet) => (
                <div
                  key={pet.id}
                  className={`pet-card ${selectedId === pet.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(pet.id === selectedId ? null : pet.id)}
                >
                  <div className="pet-card-preview">
                    <PetRenderer
                      spritesheetPath={pet.spritesheetPath}
                      size={56}
                      animationRow={0}
                      rowFrameCounts={pet.frameCounts}
                    />
                  </div>
                  <div className="pet-card-info">
                    <div className="pet-card-name">{pet.displayName}</div>
                    <div className="pet-card-author">{pet.author}</div>
                    <div className="pet-card-desc">{pet.description}</div>
                    {pet.tags.length > 0 && (
                      <div className="pet-card-tags">
                        {pet.tags.map((t) => (
                          <span key={t} className="pet-card-tag">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedId === pet.id && (
                    <div className="pet-card-check">
                      <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                        <path d="M1 5l4 4L13 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pet-selector-footer">
          <button
            className="pet-selector-btn abandon"
            onClick={() => { abandon(); setSelectedId(null); onClose() }}
          >
            放归
          </button>
          <div className="pet-selector-actions">
            <button className="pet-selector-btn cancel" onClick={onClose}>取消</button>
            <button
              className="pet-selector-btn confirm"
              onClick={handleConfirm}
            >
              确认{selectedId ? '领养' : '放归'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

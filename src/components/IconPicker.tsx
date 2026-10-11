import { useI18n } from '../i18n'
import { useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Modal, PageIcon } from './ui'

const groups = [
  {
    name: 'Symbols & ideas',
    items:
      '💡 light bulb idea|⭐ star|✨ sparkles|⚡ lightning energy|🔥 fire|💫 dizzy orbit|🌟 glowing star|💥 boom explosion|💬 speech bubble|💭 thought|❓ question|❗ exclamation|✅ check done|❌ cross|⚠️ warning|⛔ stop|🔴 red circle|🟠 orange circle|🟡 yellow circle|🟢 green circle|🔵 blue circle|🟣 purple circle|⚫ black circle|⚪ white circle|❤️ heart|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|☮️ peace|♾️ infinity|🔁 repeat|🔀 shuffle|🎯 target goal|🏁 finish flag|🚩 flag|📍 location|📌 pin|🔖 bookmark|🔔 bell reminder|⏰ alarm clock|⌛ hourglass|🕐 time clock',
  },
  {
    name: 'Work & knowledge',
    items:
      '📖 open book|📚 books library|📓 notebook|📔 journal|📕 red book|📗 green book|📘 blue book|📙 orange book|📝 memo note|📄 page document|📃 scroll page|📋 clipboard|🗂️ card files|📂 open folder|📁 folder|🗄️ cabinet|📑 tabs|🗃️ archive|✏️ pencil|🖊️ pen|🖌️ brush|📐 ruler|📏 measure|✂️ scissors|💼 briefcase work|🎓 graduation learning|🏫 school|🧠 brain thinking|🔬 microscope research|🔭 telescope|🧪 experiment chemistry|🧬 DNA|🧮 abacus math|📊 chart data|📈 growth|📉 decrease|🧾 receipt|📅 calendar|🗓️ date|📰 news|📜 parchment|✉️ envelope mail|📨 incoming mail|📬 mailbox|🏷️ label tag',
  },
  {
    name: 'Technology & tools',
    items:
      '💻 laptop computer|🖥️ desktop monitor|⌨️ keyboard|🖱️ mouse|📱 phone|☎️ telephone|📷 camera|🎥 video camera|📺 television|💾 disk save|💿 cd disc|📀 dvd|🔌 plug|🔋 battery|🪫 low battery|⚙️ gear settings|🛠️ tools|🔧 wrench|🔨 hammer|🪛 screwdriver|🔩 nut bolt|⛏️ pick|🧰 toolbox|🔐 lock key security|🔒 lock private|🔓 unlock|🔑 key|🗝️ old key|🛡️ shield|🧲 magnet|💎 diamond|🪙 coin|💰 money|💳 card|🧩 puzzle|🎮 game controller|🕹️ joystick|🤖 robot|👾 alien monster|🛸 flying saucer UFO|🚀 rocket|🛰️ satellite|📡 antenna|🧯 fire extinguisher',
  },
  {
    name: 'Nature & places',
    items:
      '🌱 seedling plant|🌿 herb leaf|🍀 clover luck|🌵 cactus|🌴 palm|🌳 tree|🌲 pine tree|🍁 maple leaf|🍂 fallen leaf|🌷 tulip|🌻 sunflower|🌸 blossom|🌼 flower|🌹 rose|🪻 hyacinth|🍄 mushroom|🌍 earth globe|🌎 world|🌏 planet|🌙 moon|🌕 full moon|☀️ sun|🌤️ clouds sun|☁️ cloud|🌧️ rain|❄️ snow|🌈 rainbow|🌊 wave water|🌋 volcano|⛰️ mountain|🏔️ snowy mountain|🏕️ camping|🏡 home|🏢 office|🏛️ museum|🏖️ beach|🗺️ map|🧭 compass|🌌 galaxy|🪐 saturn planet|🐈 cat|🐕 dog|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🦁 lion|🐸 frog|🐢 turtle|🐙 octopus|🦋 butterfly|🐝 bee|🐞 ladybird|🐧 penguin|🦉 owl|🦄 unicorn|🐳 whale|🐬 dolphin',
  },
  {
    name: 'Life & creativity',
    items:
      '☕ coffee|🍵 tea|🥐 croissant|🍕 pizza|🍎 apple|🍋 lemon|🍇 grapes|🍉 watermelon|🍓 strawberry|🥑 avocado|🍪 cookie|🎂 birthday cake|🍰 cake|🧁 cupcake|🍫 chocolate|🥂 celebration|🎨 art palette|🎭 theater|🎬 movie|🎼 music score|🎵 music note|🎸 guitar|🎹 piano|🎤 microphone|🎧 headphones|🎺 trumpet|🎻 violin|🎲 dice|♟️ chess|🃏 joker|🎁 gift|🎉 party|🎊 confetti|🎈 balloon|🧸 teddy bear|🏆 trophy|🥇 medal|⚽ football|🏀 basketball|🎾 tennis|🏓 table tennis|🏃 running|🚴 bike|🏊 swimming|🧘 meditation|✈️ airplane travel|🚗 car|🚲 bicycle|🚆 train|⛵ sailboat|🧳 luggage|😊 smile|😎 sunglasses|🤔 thinking|🤩 excited|🙌 hands|👍 thumbs up|👏 applause|🤝 handshake|👋 wave',
  },
].map((group) => ({
  ...group,
  items: group.items.split('|').map((item) => {
    const [icon, ...words] = item.split(' ')
    return { icon, label: words.join(' ') }
  }),
}))
const lineIcons = [
  'file',
  'table',
  'wrench',
  'folder',
  'shield',
  'notebook',
  'layers',
  'graduation',
  'sparkles',
]

export function IconPicker({
  value,
  onSelect,
  onClose,
  title = 'Choose a page icon',
  emojisOnly = false,
  children,
}: {
  value: string
  onSelect: (value: string) => void
  onClose: () => void
  title?: string
  emojisOnly?: boolean
  children?: ReactNode
}) {
  const { t, language } = useI18n()

  const [query, setQuery] = useState('')
  const matches = (icon: string, label: string) =>
    `${icon} ${label} ${t(label)}`.toLowerCase().includes(query.toLowerCase().trim())
  const choices = groups.flatMap((g) => g.items).filter((i) => matches(i.icon, i.label))
  return (
    <Modal title={t(title)} onClose={onClose}>
      <div className="icon-picker-content">
        {children}
        <div className="search-input">
          <Search size={16} />
          <input
            autoFocus
            aria-label={t('Search icons')}
            placeholder={t('Search emoji or icons…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="icon-picker-scroll">
          {!emojisOnly && lineIcons.some((i) => matches(i, i)) && (
            <section>
              <h3>{t('Icons')}</h3>
              <div className="icon-picker-grid">
                {lineIcons
                  .filter((i) => matches(i, i))
                  .map((icon) => (
                    <button
                      key={icon}
                      title={icon}
                      aria-label={icon}
                      aria-pressed={icon === value}
                      onClick={() => onSelect(icon)}
                    >
                      <PageIcon icon={icon} size={23} />
                    </button>
                  ))}
              </div>
            </section>
          )}
          {groups.map((group) => {
            const items = group.items.filter((i) => matches(i.icon, i.label))
            return items.length ? (
              <section key={t(group.name)}>
                <h3>{t(group.name)}</h3>
                <div className="icon-picker-grid">
                  {items.map((item) => (
                    <button
                      key={item.icon}
                      title={t(item.label)}
                      aria-label={t(item.label)}
                      aria-pressed={item.icon === value}
                      onClick={() => onSelect(item.icon)}
                    >
                      {item.icon}
                    </button>
                  ))}
                </div>
              </section>
            ) : null
          })}
          {!choices.length && (emojisOnly || !lineIcons.some((i) => matches(i, i))) && (
            <p className="empty-hint">{t('No matching icons.')}</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

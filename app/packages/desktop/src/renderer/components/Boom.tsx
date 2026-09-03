/**
 * 兜底：界面塌了的时候，把话说出来，而不是白给一片纸。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么必须有这个】
 *
 * 作者报的：「打开任何书都是一片纯白，啥也没有。」
 *
 * React 的默认行为是：渲染时抛异常就**把整棵树卸掉**。于是屏幕纯白，
 * 而作者能告诉我的全部信息就是「白的」—— 我既不知道是哪个组件、
 * 也不知道是什么错，只能靠猜。
 *
 * 白屏最坏的地方不是它坏了，是**它什么都不说**。
 *
 * 加一层边界之后：错还是那个错，但屏幕上会写着哪儿炸的、错是什么，
 * 还有一个「回书架」的出口 —— 至少他的稿子还在，而且他能截个图给我。
 *
 * 【它不负责修好】
 *
 * 这不是「容错」，是**报错**。它不吞异常、不假装没事，
 * 控制台里那份完整堆栈照样留着。
 * ─────────────────────────────────────────────────────────────
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 塌的是哪一块，显示给作者看。比如「稿纸」「书架」 */
  where: string
  /** 给一个出口。没有的话他只能重启软件 */
  onEscape?: { label: string; run(): void }
}

interface State {
  err: Error | null
  stack: string
}

export class Boom extends Component<Props, State> {
  override state: State = { err: null, stack: '' }

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err }
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    // 控制台里留全的 —— 冒烟会把 console 报错收进 problems，
    // 那是它能自动发现这类问题的唯一途径
    console.error('[不咕鸟] 界面塌了：', err, info.componentStack)
    this.setState({ stack: info.componentStack ?? '' })
  }

  override render(): ReactNode {
    const { err, stack } = this.state
    if (!err) return this.props.children

    return (
      <div className="boom">
        <div className="boom-box">
          <div className="boom-title">{this.props.where}这块崩了</div>
          <div className="boom-why">{err.message || String(err)}</div>

          <div className="boom-hint">
            {/*
              第一句必须是这个。界面崩了的时候人第一个念头是「我的稿子呢」，
              先把这件事按住，再谈别的
            */}
            <b>你的稿子没事</b> —— 它是硬盘上的 .md 文件，跟界面没关系。
            <br />
            把这段截图发给我，能直接定位到是哪儿。
          </div>

          <div className="plan-actions">
            {this.props.onEscape && (
              <button className="btn btn-primary" onClick={this.props.onEscape.run}>
                {this.props.onEscape.label}
              </button>
            )}
            <button
              className="btn"
              onClick={() => void navigator.clipboard.writeText(`${err.stack ?? err.message}\n${stack}`)}
            >
              复制报错
            </button>
          </div>

          {stack && (
            <pre className="boom-stack">{stack.split('\n').slice(0, 12).join('\n')}</pre>
          )}
        </div>
      </div>
    )
  }
}

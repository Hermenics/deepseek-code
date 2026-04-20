import { describe, it, expect } from 'bun:test'
import React from 'react'

import { renderLines } from '../src/ui/messages/MessageList.js'

describe('renderLines', () => {
  describe('comportamento básico', () => {
    it('should return a valid React element when given plain text', () => {
      // Arrange
      const text = 'texto simples'

      // Act
      const result = renderLines(text)

      // Assert
      expect(React.isValidElement(result)).toBe(true)
    })

    it('should return a Box with flexDirection="column"', () => {
      // Arrange
      const text = 'linha1\nlinha2'

      // Act
      const result = renderLines(text)

      // Assert
      expect((result as React.ReactElement).props.flexDirection).toBe('column')
    })

    it('should render single line text as exactly 1 Text child', () => {
      // Arrange
      const text = 'texto simples sem newline'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert
      expect(children).toHaveLength(1)
    })

    it('should preserve text content of a single line', () => {
      // Arrange
      const text = 'texto simples sem newline'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children)
      const firstChild = children[0] as React.ReactElement

      // Assert
      expect(firstChild.props.children).toBe('texto simples sem newline')
    })

    it('should split "linha1\\nlinha2" into exactly 2 Text children', () => {
      // Arrange
      const text = 'linha1\nlinha2'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert
      expect(children).toHaveLength(2)
    })

    it('should preserve content of each line when splitting', () => {
      // Arrange
      const text = 'linha1\nlinha2'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children) as React.ReactElement[]

      // Assert
      expect(children[0].props.children).toBe('linha1')
      expect(children[1].props.children).toBe('linha2')
    })

    it('should split "a\\nb\\nc" into exactly 3 Text children', () => {
      // Arrange
      const text = 'a\nb\nc'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert
      expect(children).toHaveLength(3)
    })

    it('should preserve content of all 3 lines', () => {
      // Arrange
      const text = 'a\nb\nc'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children) as React.ReactElement[]

      // Assert
      expect(children[0].props.children).toBe('a')
      expect(children[1].props.children).toBe('b')
      expect(children[2].props.children).toBe('c')
    })
  })

  describe('mensagem user com newline', () => {
    it('should render user message "linha1\\nlinha2" as 2 lines without extra blank lines', () => {
      // Arrange
      const userContent = 'linha1\nlinha2'

      // Act
      const result = renderLines(userContent)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert — exatamente 2, sem linhas vazias extras
      expect(children).toHaveLength(2)
    })

    it('should render user message with plain text normally', () => {
      // Arrange
      const userContent = 'mensagem normal sem quebra'

      // Act
      const result = renderLines(userContent)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert
      expect(children).toHaveLength(1)
    })
  })

  describe('stream assistente com newline', () => {
    it('should render assistant stream "a\\nb\\nc" as 3 lines', () => {
      // Arrange
      const streamText = 'a\nb\nc'

      // Act
      const result = renderLines(streamText)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert
      expect(children).toHaveLength(3)
    })

    it('should render assistant stream with multiline output correctly', () => {
      // Arrange
      const streamText = 'output linha1\noutput linha2'

      // Act
      const result = renderLines(streamText)
      const children = React.Children.toArray((result as React.ReactElement).props.children) as React.ReactElement[]

      // Assert
      expect(children).toHaveLength(2)
      expect(children[0].props.children).toBe('output linha1')
      expect(children[1].props.children).toBe('output linha2')
    })
  })

  describe('mensagem terminal com newline', () => {
    it('should render terminal output with \\n as separate lines without extra blanks', () => {
      // Arrange
      const terminalOutput = 'stdout linha1\nstdout linha2\nstdout linha3'

      // Act
      const result = renderLines(terminalOutput)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert
      expect(children).toHaveLength(3)
    })
  })

  describe('edge cases', () => {
    it('should not throw when given empty string', () => {
      expect(() => renderLines('')).not.toThrow()
    })

    it('should return a valid React element for empty string', () => {
      const result = renderLines('')
      expect(React.isValidElement(result)).toBe(true)
    })

    it('should not throw when given only \\n', () => {
      expect(() => renderLines('\n')).not.toThrow()
    })

    it('should return a valid React element for string with only \\n', () => {
      const result = renderLines('\n')
      expect(React.isValidElement(result)).toBe(true)
    })

    it('should not create more children than lines in the string for \\n at start', () => {
      // Arrange — "\nlinha1" tem 2 partes ao dividir por \n
      const text = '\nlinha1'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert — no máximo 2 filhos, sem linhas extras além das do input
      expect(children.length).toBeLessThanOrEqual(2)
    })

    it('should not create more children than lines in the string for \\n at end', () => {
      // Arrange — "linha1\n" tem 2 partes ao dividir por \n
      const text = 'linha1\n'

      // Act
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      // Assert — no máximo 2 filhos, sem linhas extras além das do input
      expect(children.length).toBeLessThanOrEqual(2)
    })

    it('should not throw when given consecutive \\n', () => {
      expect(() => renderLines('a\n\nb')).not.toThrow()
    })

    it('should handle consecutive \\n and return valid element', () => {
      const result = renderLines('a\n\nb')
      expect(React.isValidElement(result)).toBe(true)
    })

    it('should not throw when given only whitespace', () => {
      expect(() => renderLines('   ')).not.toThrow()
    })

    it('should handle very long lines without throwing', () => {
      const longLine = 'x'.repeat(10_000)
      expect(() => renderLines(longLine)).not.toThrow()
    })

    it('should handle many newlines without throwing', () => {
      const manyLines = Array.from({ length: 100 }, (_, i) => `linha ${i}`).join('\n')
      expect(() => renderLines(manyLines)).not.toThrow()
    })

    it('should handle many newlines and return correct count', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `linha ${i}`)
      const text = lines.join('\n')

      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children)

      expect(children).toHaveLength(100)
    })
  })

  describe('caracteres especiais e encodings', () => {
    it('should not throw when given Windows line endings (\\r\\n)', () => {
      expect(() => renderLines('linha1\r\nlinha2')).not.toThrow()
    })

    it('should return a valid React element for Windows line endings', () => {
      const result = renderLines('linha1\r\nlinha2')
      expect(React.isValidElement(result)).toBe(true)
    })

    it('should strip \\r from lines when given Windows line endings', () => {
      const result = renderLines('linha1\r\nlinha2')
      const children = React.Children.toArray((result as React.ReactElement).props.children) as React.ReactElement[]
      expect(children[0].props.children).toBe('linha1') // sem \r
      expect(children[1].props.children).toBe('linha2')
    })

    it('should not throw when given carriage return only (\\r)', () => {
      expect(() => renderLines('linha1\rlinha2')).not.toThrow()
    })

    it('should not throw when given tab characters', () => {
      expect(() => renderLines('coluna1\tcoluna2')).not.toThrow()
    })

    it('should preserve tab characters in content', () => {
      const text = 'coluna1\tcoluna2'
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children) as React.ReactElement[]
      expect(children[0].props.children).toBe('coluna1\tcoluna2')
    })

    it('should not throw when given unicode characters', () => {
      expect(() => renderLines('linha com unicode: 你好\noutro: こんにちは')).not.toThrow()
    })

    it('should preserve unicode content across lines', () => {
      const text = '你好\nこんにちは'
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children) as React.ReactElement[]
      expect(children).toHaveLength(2)
      expect(children[0].props.children).toBe('你好')
      expect(children[1].props.children).toBe('こんにちは')
    })

    it('should not throw when given emoji characters', () => {
      expect(() => renderLines('status: ✓\nerro: ✗')).not.toThrow()
    })

    it('should preserve emoji content across lines', () => {
      const text = '✓ passou\n✗ falhou'
      const result = renderLines(text)
      const children = React.Children.toArray((result as React.ReactElement).props.children) as React.ReactElement[]
      expect(children).toHaveLength(2)
      expect(children[0].props.children).toBe('✓ passou')
      expect(children[1].props.children).toBe('✗ falhou')
    })

    it('should not throw when given ANSI escape codes (common in terminal output)', () => {
      const ansiText = '\x1b[32mgreen text\x1b[0m\n\x1b[31mred text\x1b[0m'
      expect(() => renderLines(ansiText)).not.toThrow()
    })

    it('should split ANSI-colored output by newline correctly', () => {
      const ansiText = '\x1b[32mgreen\x1b[0m\n\x1b[31mred\x1b[0m'
      const result = renderLines(ansiText)
      const children = React.Children.toArray((result as React.ReactElement).props.children)
      expect(children).toHaveLength(2)
    })

    it('should not throw when given null byte in string', () => {
      expect(() => renderLines('antes\x00depois')).not.toThrow()
    })

    it('should handle mixed newlines (\\n and \\r\\n) without throwing', () => {
      expect(() => renderLines('unix\nwindows\r\nunix2')).not.toThrow()
    })
  })
})

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RainBars, TempLine } from './Charts.jsx';

const horas = [
  { t: '2026-09-30T12:00:00-03:00', mm: 0, tempC: 24 },
  { t: '2026-09-30T13:00:00-03:00', mm: 3.9, tempC: 25 },
  { t: '2026-09-30T14:00:00-03:00', mm: 0.1, tempC: 23 },
];

describe('Gráficos por hora', () => {
  it('valores de cada hora numa tabela para leitores de tela (o SVG só tem a descrição geral)', () => {
    render(<RainBars data={horas} label="Chuva em 30/09/2026" destaque="2026-09-30T13:00:00-03:00" />);
    expect(screen.getByRole('img', { name: 'Chuva em 30/09/2026' })).toBeTruthy();
    const tabela = screen.getByRole('table', { name: 'Chuva em 30/09/2026' });
    expect(tabela.parentElement.className).toBe('sr'); // escondida num <div>: a tabela não alarga a página
    expect(within(tabela).getByRole('rowheader', { name: '13h' }).nextSibling.textContent).toBe('3,9 mm');
    expect(within(tabela).getAllByRole('row')).toHaveLength(4); // cabeçalho + 3 horas
  });

  it('destaque: a barra escolhida usa a classe de destaque; null não destaca nenhuma', () => {
    const { container, rerender } = render(<RainBars data={horas} destaque="2026-09-30T13:00:00-03:00" />);
    expect(container.querySelectorAll('rect.g-barra.on')).toHaveLength(1);
    rerender(<RainBars data={horas} destaque={null} />);
    expect(container.querySelectorAll('rect.g-barra.on')).toHaveLength(0);
  });

  it('temperatura: tabela com as temperaturas e cores vindas do CSS, sem cor fixa no SVG', () => {
    const { container } = render(<TempLine data={horas} label="Temperatura em 30/09/2026" />);
    const tabela = screen.getByRole('table', { name: 'Temperatura em 30/09/2026' });
    expect(within(tabela).getByRole('rowheader', { name: '12h' }).nextSibling.textContent).toBe('24 °C');
    expect(container.querySelector('svg').innerHTML).not.toMatch(/fill="#|stroke="#/);
  });
});

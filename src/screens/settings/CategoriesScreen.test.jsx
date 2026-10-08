import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CategoriesScreen from './CategoriesScreen';

const categories = [
  { _id: 'c1', name: 'Продукты', type: 'expense' },
  { _id: 'c2', name: 'Кафе', type: 'expense' },
  { _id: 'c3', name: 'Такси', type: 'expense' },
  { _id: 'c4', name: 'Зарплата', type: 'income' },
];

const categoryUsage = {
  'expense::Продукты': 412,
  'expense::Кафе': 1,
  'income::Зарплата': 22,
};

const renderScreen = (props = {}) => {
  const handlers = {
    onBack: vi.fn(),
    onAdd: vi.fn().mockResolvedValue(true),
    onRename: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true),
    ...props,
  };
  const utils = render(
    <CategoriesScreen categories={categories} categoryUsage={categoryUsage} {...handlers} />
  );
  return { ...utils, ...handlers };
};

const openMenu = (name) => fireEvent.click(screen.getByRole('button', { name: `Действия: ${name}` }));

afterEach(() => vi.restoreAllMocks());

describe('CategoriesScreen', () => {
  it('titles the screen and goes back through «Ещё»', () => {
    const { onBack } = renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: 'Категории' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows per-type counts and switches the list', () => {
    renderScreen();

    expect(screen.getByRole('button', { name: 'Расходы · 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Доходы · 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Продукты')).toBeInTheDocument();
    expect(screen.queryByText('Зарплата')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Доходы · 1' }));

    expect(screen.getByText('Зарплата')).toBeInTheDocument();
    expect(screen.queryByText('Продукты')).not.toBeInTheDocument();
  });

  it('shows usage with the right plural or «не используется»', () => {
    renderScreen();

    expect(screen.getByText('412 операций')).toBeInTheDocument();
    expect(screen.getByText('1 операция')).toBeInTheDocument();
    expect(screen.getByText('не используется')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Доходы · 1' }));
    expect(screen.getByText('22 операции')).toBeInTheDocument();
  });

  describe('menu', () => {
    it('opens with rename and delete items and reports aria-expanded', () => {
      renderScreen();
      const trigger = screen.getByRole('button', { name: 'Действия: Продукты' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const menu = screen.getByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: 'Переименовать' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument();
    });

    it('closes on outside click', async () => {
      const user = userEvent.setup();
      renderScreen();
      openMenu('Продукты');
      expect(screen.getByRole('menu')).toBeInTheDocument();

      await user.click(document.body);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes on Escape', () => {
      renderScreen();
      openMenu('Продукты');

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('toggles on the same button and keeps only one menu open', () => {
      renderScreen();
      openMenu('Продукты');
      openMenu('Кафе');

      expect(screen.getAllByRole('menu')).toHaveLength(1);

      openMenu('Кафе');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('rename', () => {
    const startRename = (name) => {
      openMenu(name);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }));
    };

    it('shows how many operations change and prefills the name', () => {
      renderScreen();
      startRename('Продукты');

      const input = screen.getByRole('textbox', { name: 'Новое название · изменится в 412 операциях' });
      expect(input).toHaveValue('Продукты');
    });

    it('omits the operation count for an unused category', () => {
      renderScreen();
      startRename('Такси');

      expect(screen.getByRole('textbox', { name: 'Новое название' })).toHaveValue('Такси');
    });

    it('submits on Enter and closes on success', async () => {
      const user = userEvent.setup();
      const { onRename } = renderScreen();
      startRename('Продукты');
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Еда{Enter}');

      expect(onRename).toHaveBeenCalledWith(categories[0], 'Еда');
      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
      expect(screen.getByText('Продукты')).toBeInTheDocument();
    });

    it('stays open with the typed text when onRename resolves false', async () => {
      const user = userEvent.setup();
      const { onRename } = renderScreen({ onRename: vi.fn().mockResolvedValue(false) });
      startRename('Продукты');
      const input = screen.getByRole('textbox');

      await user.clear(input);
      await user.type(input, 'Кафе');
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('textbox')).toHaveValue('Кафе');
    });

    it('cancels with the button and with Escape', async () => {
      const user = userEvent.setup();
      const { onRename } = renderScreen();
      startRename('Продукты');
      await user.click(screen.getByRole('button', { name: 'Отмена' }));
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

      startRename('Продукты');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(onRename).not.toHaveBeenCalled();
    });

    it('keeps only one row in edit mode at a time', () => {
      renderScreen();
      startRename('Продукты');
      openMenu('Кафе');

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getAllByRole('menu')).toHaveLength(1);
    });
  });

  describe('delete', () => {
    const startDelete = (name) => {
      openMenu(name);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    };

    it('asks inline, explains the usage and never calls window.confirm', () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      const { onDelete } = renderScreen();

      startDelete('Продукты');

      expect(screen.getByText('Удалить категорию «Продукты»?')).toBeInTheDocument();
      expect(screen.getByText(/Её используют 412 операций\. Они останутся в истории с прежним названием, но выбрать категорию заново будет нельзя\./)).toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('calls onDelete with the category and used count, and closes on success', async () => {
      const { onDelete } = renderScreen();
      startDelete('Продукты');

      fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

      expect(onDelete).toHaveBeenCalledWith(categories[0], 412);
      await waitFor(() => expect(screen.queryByText('Удалить категорию «Продукты»?')).not.toBeInTheDocument());
    });

    it('omits the usage text for an unused category', () => {
      renderScreen();
      startDelete('Такси');

      expect(screen.getByText('Удалить категорию «Такси»?')).toBeInTheDocument();
      expect(screen.queryByText(/Её использу/)).not.toBeInTheDocument();
    });

    it('uses singular wording for one operation', () => {
      renderScreen();
      startDelete('Кафе');

      expect(screen.getByText(/Её использует 1 операция\. Она останется/)).toBeInTheDocument();
    });

    it('cancels without calling onDelete', () => {
      const { onDelete } = renderScreen();
      startDelete('Продукты');

      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

      expect(screen.queryByText('Удалить категорию «Продукты»?')).not.toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('stays open when onDelete resolves false', async () => {
      const { onDelete } = renderScreen({ onDelete: vi.fn().mockResolvedValue(false) });
      startDelete('Такси');

      fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(categories[2], 0));
      expect(screen.getByText('Удалить категорию «Такси»?')).toBeInTheDocument();
    });
  });

  describe('add', () => {
    it('adds a category of the selected type', async () => {
      const user = userEvent.setup();
      const { onAdd } = renderScreen();
      fireEvent.click(screen.getByRole('button', { name: 'Доходы · 1' }));

      await user.click(screen.getByRole('button', { name: 'Новая категория' }));
      await user.type(screen.getByRole('textbox', { name: 'Новая категория' }), 'Подарки{Enter}');

      expect(onAdd).toHaveBeenCalledWith('Подарки', 'income');
      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    });

    it('stays open with the text when onAdd resolves false', async () => {
      const user = userEvent.setup();
      const { onAdd } = renderScreen({ onAdd: vi.fn().mockResolvedValue(false) });

      await user.click(screen.getByRole('button', { name: 'Новая категория' }));
      await user.type(screen.getByRole('textbox'), 'Кафе');
      await user.click(screen.getByRole('button', { name: 'Добавить' }));

      await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Кафе', 'expense'));
      expect(screen.getByRole('textbox')).toHaveValue('Кафе');
    });

    it('cancels and closes when switching the type', async () => {
      const user = userEvent.setup();
      renderScreen();

      await user.click(screen.getByRole('button', { name: 'Новая категория' }));
      await user.click(screen.getByRole('button', { name: 'Отмена' }));
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Новая категория' }));
      await user.click(screen.getByRole('button', { name: 'Доходы · 1' }));
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });
});

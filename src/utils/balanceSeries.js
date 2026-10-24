// Остаток на конец каждого месяца ряда из ответа сервера (monthEndBalances
// одного счёта или капитала). Сервер присылает только месяцы с операциями:
// в месяце без операций остаток тот же, что в предыдущем. До первой операции
// остатка нет - null, а не ноль: счёта тогда ещё не было.
export function withMonthEndBalances(series, balancesByMonth) {
    const known = Object.keys(balancesByMonth || {}).sort();
    let index = 0;
    let balance = null;
    return series.map(item => {
        while (index < known.length && known[index] <= item.month) {
            balance = balancesByMonth[known[index]];
            index += 1;
        }
        return { ...item, balance };
    });
}

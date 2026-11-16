const API = '/api';
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const state = {
    user: null,
    page: 'overview',
    categories: [],
    transactions: [],
    charts: {},
    toastTimer: null
};

const loginScreen = $('#login-screen');
const application = $('#application');
const loginForm = $('#login-form');
const loginError = $('#login-error');
const loginSubmit = $('#login-submit');
const loginRole = $('#login-role');
const navigation = $('#navigation');
const mainContent = $('#main-content');
const toast = $('#toast');

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[character]);
}

function money(value) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(value) || 0);
}

function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

async function apiRequest(endpoint, options = {}) {
    const config = {
        method: options.method || 'GET',
        credentials: 'same-origin',
        headers: options.body ? { 'Content-Type': 'application/json' } : {}
    };

    if (options.body) config.body = JSON.stringify(options.body);

    const response = await fetch(`${API}${endpoint}`, config);
    let result = {};

    try {
        result = await response.json();
    } catch (error) {
        result = {};
    }

    if (!response.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
}

function setLoginRole(role) {
    loginRole.value = role;
    $$('.role-tab').forEach(button => {
        const selected = button.dataset.role === role;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
}

function restorePreferences() {
    const email = localStorage.getItem('paisatrack:email');
    const role = localStorage.getItem('paisatrack:role');

    if (email) {
        $('#login-email').value = email;
        $('#remember-email').checked = true;
    }

    if (role === 'admin' || role === 'user') setLoginRole(role);
}

function showLogin() {
    loginScreen.classList.remove('hidden');
    application.classList.add('hidden');
    loginError.textContent = '';
}

function showApp() {
    loginScreen.classList.add('hidden');
    application.classList.remove('hidden');
}

async function handleLogin(event) {
    event.preventDefault();
    loginError.textContent = '';
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Verifying...';

    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const role = loginRole.value;

    try {
        const result = await apiRequest('/auth/login', {
            method: 'POST',
            body: { email, password, role }
        });

        if ($('#remember-email').checked) {
            localStorage.setItem('paisatrack:email', email);
        } else {
            localStorage.removeItem('paisatrack:email');
        }
        localStorage.setItem('paisatrack:role', role);
        loginForm.reset();
        restorePreferences();
        await enterApp(result.user);
    } catch (error) {
        loginError.textContent = error.message;
    } finally {
        loginSubmit.disabled = false;
        loginSubmit.textContent = 'Sign in';
    }
}

async function enterApp(user) {
    state.user = user;
    state.page = 'overview';
    $('#profile-name').textContent = user.name;
    $('#profile-role').textContent = user.role === 'admin' ? 'Administrator' : 'User account';
    $('#profile-initial').textContent = user.name.trim().charAt(0).toUpperCase();
    showApp();
    buildNavigation();
    await navigate('overview');
}

function buildNavigation() {
    const links = state.user.role === 'admin'
        ? [
            { page: 'overview', label: 'Overview', icon: '▦' },
            { page: 'users', label: 'User accounts', icon: '♙' }
        ]
        : [
            { page: 'overview', label: 'Overview', icon: '▦' },
            { page: 'transactions', label: 'Transactions', icon: '↕' },
            { page: 'categories', label: 'Categories', icon: '◈' },
            { page: 'reports', label: 'Reports', icon: '▤' }
        ];

    navigation.innerHTML = links.map(link => `
        <button class="nav-link ${state.page === link.page ? 'active' : ''}"
                type="button" data-page="${link.page}">
            <span class="nav-icon">${link.icon}</span>
            <span>${link.label}</span>
        </button>
    `).join('');

    $$('.nav-link', navigation).forEach(button => {
        button.addEventListener('click', () => navigate(button.dataset.page));
    });
}

async function navigate(page) {
    state.page = page;
    buildNavigation();
    mainContent.innerHTML = '<div class="loading-box">Loading...</div>';

    try {
        if (state.user.role === 'admin') {
            if (page === 'users') await renderAdminUsers();
            else await renderAdminOverview();
            return;
        }

        if (page === 'transactions') await renderTransactions();
        else if (page === 'categories') await renderCategories();
        else if (page === 'reports') await renderReports();
        else await renderUserOverview();
    } catch (error) {
        mainContent.innerHTML = `<div class="loading-box">${escapeHTML(error.message)}</div>`;
        showToast(error.message, true);
    }
}

function statCard(label, value, symbol, note) {
    return `
        <article class="stat-card">
            <div class="stat-top"><span>${label}</span><span class="stat-symbol">${symbol}</span></div>
            <strong>${value}</strong>
            <small>${note || ''}</small>
        </article>
    `;
}

function transactionRows(items, showActions = false) {
    if (!items.length) {
        return `<tr><td colspan="${showActions ? 6 : 5}" class="empty-cell">No transactions found.</td></tr>`;
    }

    return items.map(item => `
        <tr>
            <td>${escapeHTML(item.date)}</td>
            <td><strong>${escapeHTML(item.description || '—')}</strong></td>
            <td>${escapeHTML(item.category)}</td>
            <td><span class="type-pill ${item.type}">${item.type}</span></td>
            <td class="${item.type === 'income' ? 'income-text' : 'expense-text'}">
                ${item.type === 'income' ? '+' : '−'}${money(item.amount)}
            </td>
            ${showActions ? `<td class="actions-cell">
                <button class="mini-button" type="button" data-edit="${escapeHTML(item.id)}">Edit</button>
                <button class="mini-button danger" type="button" data-delete="${escapeHTML(item.id)}">Delete</button>
            </td>` : ''}
        </tr>
    `).join('');
}

function destroyChart(id) {
    if (state.charts[id]) {
        state.charts[id].destroy();
        delete state.charts[id];
    }
}

function makeCashflowChart(canvasId, monthly) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    destroyChart(canvasId);
    const labels = monthly.map(item => {
        const [year, month] = item.month.split('-');
        return new Date(Number(year), Number(month) - 1)
            .toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    });

    state.charts[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Income', data: monthly.map(item => item.income), backgroundColor: '#6eaa80', borderRadius: 5 },
                { label: 'Expenses', data: monthly.map(item => item.expense), backgroundColor: '#d58e83', borderRadius: 5 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
                tooltip: { callbacks: { label: context => `${context.dataset.label}: ${money(context.raw)}` } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: value => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(value) } },
                x: { grid: { display: false } }
            }
        }
    });
}

function makeCategoryChart(canvasId, categories) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    destroyChart(canvasId);
    state.charts[canvasId] = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: categories.map(item => item.category),
            datasets: [{
                data: categories.map(item => item.amount),
                backgroundColor: ['#376f4e', '#74a985', '#b6cfba', '#d7a18f', '#d8c58c', '#8ca8b5', '#aa9fbd', '#c8aaa1'],
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
                tooltip: { callbacks: { label: context => `${context.label}: ${money(context.raw)}` } }
            }
        }
    });
}

async function renderUserOverview() {
    const [summary, recent] = await Promise.all([
        apiRequest('/reports/summary'),
        apiRequest('/transactions?limit=6')
    ]);

    mainContent.innerHTML = `
        <div class="page-heading">
            <div><p class="eyebrow">YOUR MONEY AT A GLANCE</p><h1>Overview</h1><p>See your income, expenses and current balance.</p></div>
        </div>
        <section class="stats-grid">
            ${statCard('Current balance', money(summary.totals.balance), '₹', 'Income minus expenses')}
            ${statCard('Total income', money(summary.totals.income), '↗', 'Recorded income')}
            ${statCard('Total expenses', money(summary.totals.expenses), '↘', 'Recorded expenses')}
            ${statCard('Transactions', summary.transactionCount, '▤', 'All recorded entries')}
        </section>
        <section class="dashboard-grid">
            <article class="panel">
                <div class="panel-heading"><div><h2>Expenses by category</h2><p>Where your money is going.</p></div></div>
                <div class="chart-area"><canvas id="home-category-chart"></canvas><p id="home-category-empty" class="chart-empty">No expense data yet.</p></div>
            </article>
            <article class="panel">
                <div class="panel-heading"><div><h2>Monthly cash flow</h2><p>Income compared with expenses.</p></div></div>
                <div class="chart-area"><canvas id="home-cashflow-chart"></canvas><p id="home-cashflow-empty" class="chart-empty">Add transactions to see monthly activity.</p></div>
            </article>
        </section>
        <section class="panel table-panel">
            <div class="panel-heading"><div><h2>Recent transactions</h2><p>Your latest financial activity.</p></div><button id="view-transactions" class="text-button" type="button">View all</button></div>
            <div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th>Amount</th></tr></thead><tbody>${transactionRows(recent.transactions)}</tbody></table></div>
        </section>
    `;

    if (summary.expenseByCategory.length) {
        makeCategoryChart('home-category-chart', summary.expenseByCategory);
        $('#home-category-empty').style.display = 'none';
    } else {
        $('#home-category-chart').style.display = 'none';
        $('#home-category-empty').style.display = 'block';
    }

    if (summary.monthly.length) {
        makeCashflowChart('home-cashflow-chart', summary.monthly);
        $('#home-cashflow-empty').style.display = 'none';
    } else {
        $('#home-cashflow-chart').style.display = 'none';
        $('#home-cashflow-empty').style.display = 'block';
    }

    $('#view-transactions').addEventListener('click', () => navigate('transactions'));
}

async function getCategories() {
    const result = await apiRequest('/categories');
    state.categories = result.categories;
    return state.categories;
}

function populateCategoryOptions(select, type, selected = '') {
    const available = state.categories.filter(category => category.type === type);
    select.innerHTML = `<option value="">Select category</option>${available.map(category => `
        <option value="${escapeHTML(category.name)}" ${category.name === selected ? 'selected' : ''}>${escapeHTML(category.name)}</option>
    `).join('')}`;
}

function transactionFormHTML() {
    return `
        <section class="form-card">
            <h2 id="form-title">Add a transaction</h2>
            <p class="form-note">Record money received or money spent. Enter amounts in Indian Rupees.</p>
            <form id="transaction-form">
                <input id="transaction-id" type="hidden">
                <div class="form-grid">
                    <div class="form-field"><label for="transaction-type">Type</label><select id="transaction-type"><option value="expense">Expense</option><option value="income">Income</option></select></div>
                    <div class="form-field"><label for="transaction-amount">Amount (₹)</label><input id="transaction-amount" type="number" min="0.01" max="1000000000" step="0.01" placeholder="e.g. 850" required></div>
                    <div class="form-field full"><label for="transaction-category">Category</label><select id="transaction-category" required></select></div>
                    <div class="form-field full"><label for="transaction-date">Date</label><input id="transaction-date" type="date" required></div>
                    <div class="form-field full"><label for="transaction-description">Description</label><input id="transaction-description" type="text" maxlength="120" placeholder="e.g. Monthly groceries"></div>
                </div>
                <p id="transaction-error" class="form-error" aria-live="polite"></p>
                <div class="form-actions">
                    <button id="save-transaction" class="button primary-button" type="submit">Save transaction</button>
                    <button id="cancel-edit" class="button quiet-button hidden" type="button">Cancel edit</button>
                </div>
            </form>
        </section>
    `;
}

async function renderTransactions() {
    await getCategories();
    const result = await apiRequest('/transactions');
    state.transactions = result.transactions;

    mainContent.innerHTML = `
        <div class="page-heading"><div><p class="eyebrow">INCOME AND EXPENSES</p><h1>Transactions</h1><p>Add, edit, search and remove your financial entries.</p></div></div>
        <div class="content-grid">
            ${transactionFormHTML()}
            <section class="panel table-panel">
                <div class="panel-heading"><div><h2>All transactions</h2><p id="transaction-count">${state.transactions.length} entries</p></div></div>
                <div class="filter-row">
                    <input id="transaction-search" type="search" placeholder="Search description or category">
                    <select id="transaction-filter"><option value="all">All types</option><option value="income">Income</option><option value="expense">Expense</option></select>
                </div>
                <div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th>Amount</th><th>Actions</th></tr></thead><tbody id="transactions-body"></tbody></table></div>
            </section>
        </div>
    `;

    $('#transaction-date').value = localDateString();
    populateCategoryOptions($('#transaction-category'), $('#transaction-type').value);
    $('#transaction-type').addEventListener('change', () => populateCategoryOptions($('#transaction-category'), $('#transaction-type').value));
    $('#transaction-form').addEventListener('submit', saveTransaction);
    $('#cancel-edit').addEventListener('click', resetTransactionForm);
    $('#transaction-search').addEventListener('input', renderTransactionRows);
    $('#transaction-filter').addEventListener('change', renderTransactionRows);
    $('#transactions-body').addEventListener('click', handleTransactionAction);
    renderTransactionRows();
}

function renderTransactionRows() {
    const query = $('#transaction-search').value.trim().toLowerCase();
    const type = $('#transaction-filter').value;
    const filtered = state.transactions.filter(item => {
        const text = `${item.description} ${item.category}`.toLowerCase();
        return text.includes(query) && (type === 'all' || item.type === type);
    });
    $('#transaction-count').textContent = `${filtered.length} entries`;
    $('#transactions-body').innerHTML = transactionRows(filtered, true);
}

async function saveTransaction(event) {
    event.preventDefault();
    const id = $('#transaction-id').value;
    const payload = {
        type: $('#transaction-type').value,
        amount: Number($('#transaction-amount').value),
        category: $('#transaction-category').value,
        date: $('#transaction-date').value,
        description: $('#transaction-description').value.trim()
    };

    try {
        if (id) {
            await apiRequest(`/transactions/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
            showToast('Transaction updated.');
        } else {
            await apiRequest('/transactions', { method: 'POST', body: payload });
            showToast('Transaction added.');
        }
        await renderTransactions();
    } catch (error) {
        $('#transaction-error').textContent = error.message;
    }
}

function resetTransactionForm() {
    $('#transaction-form').reset();
    $('#transaction-id').value = '';
    $('#transaction-date').value = localDateString();
    $('#form-title').textContent = 'Add a transaction';
    $('#save-transaction').textContent = 'Save transaction';
    $('#cancel-edit').classList.add('hidden');
    populateCategoryOptions($('#transaction-category'), $('#transaction-type').value);
    $('#transaction-error').textContent = '';
}

function handleTransactionAction(event) {
    const editButton = event.target.closest('[data-edit]');
    const deleteButton = event.target.closest('[data-delete]');

    if (editButton) {
        const item = state.transactions.find(transaction => transaction.id === editButton.dataset.edit);
        if (!item) return;

        $('#transaction-id').value = item.id;
        $('#transaction-type').value = item.type;
        $('#transaction-amount').value = item.amount;
        $('#transaction-date').value = item.date;
        $('#transaction-description').value = item.description;
        populateCategoryOptions($('#transaction-category'), item.type, item.category);
        $('#form-title').textContent = 'Edit transaction';
        $('#save-transaction').textContent = 'Update transaction';
        $('#cancel-edit').classList.remove('hidden');
        $('#transaction-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (deleteButton) {
        if (window.confirm('Delete this transaction?')) deleteTransaction(deleteButton.dataset.delete);
    }
}

async function deleteTransaction(id) {
    try {
        await apiRequest(`/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('Transaction deleted.');
        await renderTransactions();
    } catch (error) {
        showToast(error.message, true);
    }
}

async function renderCategories() {
    const categories = await getCategories();
    const income = categories.filter(item => item.type === 'income');
    const expenses = categories.filter(item => item.type === 'expense');

    mainContent.innerHTML = `
        <div class="page-heading"><div><p class="eyebrow">ORGANISE YOUR MONEY</p><h1>Categories</h1><p>Group transactions to understand where money comes from and where it goes.</p></div></div>
        <div class="content-grid">
            <section class="form-card">
                <h2>Add a category</h2>
                <p class="form-note">Custom categories belong to your account. Built-in categories cannot be deleted.</p>
                <form id="category-form">
                    <div class="form-field"><label for="category-name">Category name</label><input id="category-name" minlength="2" maxlength="40" placeholder="e.g. Pet care" required></div>
                    <div class="form-field"><label for="category-type">Category type</label><select id="category-type"><option value="expense">Expense</option><option value="income">Income</option></select></div>
                    <p id="category-error" class="form-error" aria-live="polite"></p>
                    <button class="button primary-button" type="submit">Add category</button>
                </form>
            </section>
            <section class="panel">
                <div class="panel-heading"><div><h2>Your categories</h2><p>Custom categories can be deleted when not in use.</p></div></div>
                <h3 class="category-heading">Income</h3><div id="income-categories" class="category-list"></div>
                <h3 class="category-heading">Expenses</h3><div id="expense-categories" class="category-list"></div>
            </section>
        </div>
    `;

    renderCategoryList('#income-categories', income);
    renderCategoryList('#expense-categories', expenses);
    $('#category-form').addEventListener('submit', addCategory);
    mainContent.onclick = handleCategoryAction;
}

function renderCategoryList(selector, categories) {
    const target = $(selector);
    if (!categories.length) {
        target.innerHTML = '<p class="empty-note">No categories yet.</p>';
        return;
    }

    target.innerHTML = categories.map(item => `
        <div class="category-row">
            <strong>${escapeHTML(item.name)}</strong>
            <span>${item.isCustom ? 'Custom' : 'Built in'}</span>
            ${item.isCustom ? `<button class="mini-button danger" type="button" data-category-delete="${escapeHTML(item.id)}">Delete</button>` : ''}
        </div>
    `).join('');
}

async function addCategory(event) {
    event.preventDefault();
    try {
        await apiRequest('/categories', {
            method: 'POST',
            body: { name: $('#category-name').value.trim(), type: $('#category-type').value }
        });
        showToast('Category added.');
        await renderCategories();
    } catch (error) {
        $('#category-error').textContent = error.message;
    }
}

async function handleCategoryAction(event) {
    const button = event.target.closest('[data-category-delete]');
    if (!button) return;
    if (!window.confirm('Delete this custom category?')) return;

    try {
        await apiRequest(`/categories/${encodeURIComponent(button.dataset.categoryDelete)}`, { method: 'DELETE' });
        showToast('Category deleted.');
        await renderCategories();
    } catch (error) {
        showToast(error.message, true);
    }
}

async function renderReports() {
    const from = localStorage.getItem('paisatrack:reportFrom') || `${localDateString().slice(0, 7)}-01`;
    const to = localStorage.getItem('paisatrack:reportTo') || localDateString();

    mainContent.innerHTML = `
        <div class="page-heading"><div><p class="eyebrow">UNDERSTAND YOUR FINANCES</p><h1>Financial reports</h1><p>Review income, expenses and trends for a selected date range.</p></div><button id="export-csv" class="button primary-button" type="button">Export CSV</button></div>
        <form id="report-filter" class="report-filter">
            <div><label for="report-from">From date</label><input id="report-from" type="date" value="${from}"></div>
            <div><label for="report-to">To date</label><input id="report-to" type="date" value="${to}"></div>
            <button class="button primary-button" type="submit">Apply filter</button>
        </form>
        <div id="report-content"><div class="loading-box">Preparing report...</div></div>
    `;

    $('#report-filter').addEventListener('submit', loadReport);
    $('#export-csv').addEventListener('click', exportCSV);
    await loadReport();
}

async function loadReport(event) {
    if (event) event.preventDefault();
    const from = $('#report-from').value;
    const to = $('#report-to').value;

    if (from && to && from > to) {
        showToast('The start date must be before the end date.', true);
        return;
    }

    localStorage.setItem('paisatrack:reportFrom', from);
    localStorage.setItem('paisatrack:reportTo', to);

    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
        const report = await apiRequest(`/reports/summary?${params.toString()}`);
        $('#report-content').innerHTML = `
            <section class="report-stats">
                ${statCard('Income', money(report.totals.income), '↗', 'For selected period')}
                ${statCard('Expenses', money(report.totals.expenses), '↘', 'For selected period')}
                ${statCard('Net balance', money(report.totals.balance), '₹', `${report.transactionCount} transactions`)}
            </section>
            <section class="dashboard-grid">
                <article class="panel"><div class="panel-heading"><div><h2>Monthly cash flow</h2><p>Income compared with expenses.</p></div></div><div class="chart-area"><canvas id="report-cashflow-chart"></canvas><p id="report-cashflow-empty" class="chart-empty">No data for this period.</p></div></article>
                <article class="panel"><div class="panel-heading"><div><h2>Expense categories</h2><p>Share of spending by category.</p></div></div><div class="chart-area"><canvas id="report-category-chart"></canvas><p id="report-category-empty" class="chart-empty">No expense data for this period.</p></div></article>
            </section>
            <section class="panel table-panel"><div class="panel-heading"><div><h2>Expense breakdown</h2><p>Spending grouped by category.</p></div></div><div class="table-wrap"><table><thead><tr><th>Category</th><th>Total spent</th></tr></thead><tbody>${report.expenseByCategory.length ? report.expenseByCategory.map(item => `<tr><td>${escapeHTML(item.category)}</td><td class="expense-text">${money(item.amount)}</td></tr>`).join('') : '<tr><td colspan="2" class="empty-cell">No expenses in this period.</td></tr>'}</tbody></table></div></section>
        `;

        if (report.monthly.length) {
            makeCashflowChart('report-cashflow-chart', report.monthly);
            $('#report-cashflow-empty').style.display = 'none';
        } else {
            $('#report-cashflow-chart').style.display = 'none';
            $('#report-cashflow-empty').style.display = 'block';
        }

        if (report.expenseByCategory.length) {
            makeCategoryChart('report-category-chart', report.expenseByCategory);
            $('#report-category-empty').style.display = 'none';
        } else {
            $('#report-category-chart').style.display = 'none';
            $('#report-category-empty').style.display = 'block';
        }
    } catch (error) {
        $('#report-content').innerHTML = `<div class="loading-box">${escapeHTML(error.message)}</div>`;
    }
}

function csvValue(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function exportCSV() {
    const params = new URLSearchParams();
    const from = $('#report-from').value;
    const to = $('#report-to').value;
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
        const result = await apiRequest(`/transactions?${params.toString()}`);
        const headings = ['Date', 'Type', 'Category', 'Description', 'Amount (INR)'];
        const rows = result.transactions.map(item => [item.date, item.type, item.category, item.description, item.amount]);
        const csv = [headings, ...rows].map(row => row.map(csvValue).join(',')).join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'paisatrack-report.csv';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        showToast('Report exported as CSV.');
    } catch (error) {
        showToast(error.message, true);
    }
}

async function renderAdminOverview() {
    const result = await apiRequest('/admin/overview');

    mainContent.innerHTML = `
        <div class="page-heading"><div><p class="eyebrow">ADMINISTRATION</p><h1>System overview</h1><p>High-level account and finance activity across this local installation.</p></div></div>
        <section class="stats-grid">
            ${statCard('User accounts', result.totalUsers, '♙', 'Registered users')}
            ${statCard('Transactions', result.totalTransactions, '▤', 'All recorded entries')}
            ${statCard('Total income', money(result.totals.income), '↗', 'Combined user totals')}
            ${statCard('Total expenses', money(result.totals.expenses), '↘', 'Combined user totals')}
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>System cash flow</h2><p>Combined monthly totals. Individual transaction details are not available to admins.</p></div></div><div class="chart-area"><canvas id="admin-cashflow-chart"></canvas><p id="admin-chart-empty" class="chart-empty">No transactions have been recorded.</p></div></section>
        <div class="notice-box">Admin access is limited to account administration and high-level totals. Individual transaction descriptions and records remain private to each user account.</div>
    `;

    if (result.monthly.length) {
        makeCashflowChart('admin-cashflow-chart', result.monthly);
        $('#admin-chart-empty').style.display = 'none';
    } else {
        $('#admin-cashflow-chart').style.display = 'none';
        $('#admin-chart-empty').style.display = 'block';
    }
}

async function renderAdminUsers() {
    const result = await apiRequest('/admin/users');

    mainContent.innerHTML = `
        <div class="page-heading"><div><p class="eyebrow">ACCOUNT ADMINISTRATION</p><h1>User accounts</h1><p>Create user accounts and review account-level activity.</p></div></div>
        <div class="content-grid">
            <section class="form-card">
                <h2>Create a user account</h2>
                <p class="form-note">Assign a name, email and temporary password. The new account will have user permissions.</p>
                <form id="create-user-form">
                    <label for="new-user-name">Full name</label>
                    <input id="new-user-name" minlength="2" maxlength="60" required>
                    <label for="new-user-email">Email address</label>
                    <input id="new-user-email" type="email" required>
                    <label for="new-user-password">Temporary password</label>
                    <input id="new-user-password" type="password" minlength="8" required>
                    <p id="create-user-error" class="form-error" aria-live="polite"></p>
                    <button class="button primary-button" type="submit">Create account</button>
                </form>
            </section>
            <section class="panel table-panel">
                <div class="panel-heading"><div><h2>Registered users</h2><p>${result.users.length} user accounts</p></div></div>
                <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Entries</th><th>Net balance</th></tr></thead><tbody>
                    ${result.users.length ? result.users.map(user => `<tr><td><strong>${escapeHTML(user.name)}</strong></td><td>${escapeHTML(user.email)}</td><td>${user.transactionCount}</td><td>${money(user.balance)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">No users found.</td></tr>'}
                </tbody></table></div>
            </section>
        </div>
    `;

    $('#create-user-form').addEventListener('submit', createUser);
}

async function createUser(event) {
    event.preventDefault();
    try {
        await apiRequest('/admin/users', {
            method: 'POST',
            body: {
                name: $('#new-user-name').value.trim(),
                email: $('#new-user-email').value.trim(),
                password: $('#new-user-password').value
            }
        });
        showToast('User account created.');
        await renderAdminUsers();
    } catch (error) {
        $('#create-user-error').textContent = error.message;
    }
}

async function logout() {
    try {
        await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
        // The session may already have expired.
    }

    Object.values(state.charts).forEach(chart => chart.destroy());
    state.charts = {};
    state.user = null;
    showLogin();
}

async function initialize() {
    restorePreferences();

    $$('.role-tab').forEach(button => {
        button.addEventListener('click', () => setLoginRole(button.dataset.role));
    });

    loginForm.addEventListener('submit', handleLogin);
    $('#logout-button').addEventListener('click', logout);

    try {
        const result = await apiRequest('/auth/me');
        await enterApp(result.user);
    } catch (error) {
        showLogin();
    }
}

initialize();

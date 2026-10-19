// ==========================================
// THE READING NEST - Supabase family library
// Fill in your own Supabase URL and publishable key below.
// Never put a service-role/secret key in browser code.
// ==========================================
const SUPABASE_URL = "https://mbyrtwgjkthqchamsadm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NVqpT4zxnUhUZf37zG1tqw_eHkooqMS";
const TABLE_NAME = "books";
const STORAGE_BUCKET = "book-cover";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let books = [];
let editingBookId = null;
let existingCoverURL = null;
let currentUser = null;
let currentProfile = null;
let activeBookId = null;
let pendingDuplicateKey = "";

const $ = id => document.getElementById(id);
const bookList = $("bookList");
const bookCount = $("bookCount");
const searchBox = $("searchBox");
const genreFilter = $("genreFilter");
const languageFilter = $("languageFilter");
const sortBooks = $("sortBooks");
const bookPhoto = $("bookPhoto");
const photoPreview = $("photoPreview");
const bookTitle = $("bookTitle");
const bookAuthor = $("bookAuthor");
const bookGenre = $("bookGenre");
const bookLanguage = $("bookLanguage");
const bookOwner = $("bookOwner");
const bookLocation = $("bookLocation");
const saveBookButton = $("saveBookButton");

document.addEventListener("DOMContentLoaded", async () => {
    $("loginForm").addEventListener("submit", signIn);
    $("signOutButton").addEventListener("click", signOut);
    $("pendingSignOutButton").addEventListener("click", signOut);
    saveBookButton.addEventListener("click", saveBook);
    bookPhoto.addEventListener("change", previewPhoto);
    $("editBookButton").addEventListener("click", () => {
        const id = activeBookId;
        bootstrap.Modal.getInstance($("bookDetailsModal"))?.hide();
        if (id) editBook(id);
    });
    $("deleteBookButton").addEventListener("click", () => {
        if (activeBookId) deleteBook(activeBookId);
    });
    ["input", "change"].forEach(eventName => {
        searchBox.addEventListener(eventName, displayBooks);
        genreFilter.addEventListener(eventName, displayBooks);
        languageFilter.addEventListener(eventName, displayBooks);
        sortBooks.addEventListener(eventName, displayBooks);
    });
    $("mobileSearchButton").addEventListener("click", () => {
        const container = document.querySelector(".search-container");
        container.classList.toggle("mobile-search-open");
        if (container.classList.contains("mobile-search-open")) searchBox.focus();
    });
    $("addBookOpenButton").addEventListener("click", () => resetBookForm());
    $("addBookModal").addEventListener("hidden.bs.modal", () => {
        if (!editingBookId) resetBookForm();
    });

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        showAuthMessage("Add your Supabase project URL and publishable key at the top of JS/app.js, then refresh this page.", "warning");
        return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    await handleSession(session);
    supabaseClient.auth.onAuthStateChange((_event, session) => {
        // Defer work so auth callbacks don't block Supabase's internal lock.
        setTimeout(() => handleSession(session), 0);
    });
});

async function signIn(event) {
    event.preventDefault();
    const button = $("loginButton");
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
        const { error } = await supabaseClient.auth.signInWithPassword({
            email: $("loginEmail").value.trim(),
            password: $("loginPassword").value
        });
        if (error) throw error;
        $("loginPassword").value = "";
    } catch (error) {
        showAuthMessage(error.message || "Could not sign in. Check your email and password.", "danger");
    } finally {
        button.disabled = false;
        button.textContent = "Sign in";
    }
}

async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) showToast(error.message, "Error");
    else showToast("You have signed out.", "Signed out");
}

async function handleSession(session) {
    currentUser = session?.user || null;
    currentProfile = null;
    $("authSection").classList.add("d-none");
    $("pendingSection").classList.add("d-none");
    $("librarySection").classList.add("d-none");
    $("addBookOpenButton").classList.add("d-none");
    $("signOutButton").classList.toggle("d-none", !currentUser);

    if (!currentUser) {
        $("authSection").classList.remove("d-none");
        return;
    }

    const { data: profile, error } = await supabaseClient
        .from("profiles").select("user_id, display_name, role, approved")
        .eq("user_id", currentUser.id).maybeSingle();

    if (error || !profile) {
        showAuthMessage("We couldn't load your family profile. Please contact the administrator.", "danger");
        $("authSection").classList.remove("d-none");
        return;
    }
    currentProfile = profile;

    if (!profile.approved) {
        $("pendingEmail").textContent = currentUser.email || "";
        $("pendingSection").classList.remove("d-none");
        return;
    }

    $("librarySection").classList.remove("d-none");
    $("addBookOpenButton").classList.remove("d-none");
    $("signedInLabel").textContent = `${currentUser.email || "Signed in"} · ${profile.role === "admin" ? "Administrator" : "Family member"}`;
    $("adminSection").classList.toggle("d-none", profile.role !== "admin");
    if (profile.role === "admin") await loadFamilyMembers();
    await loadBooks();
}

function showAuthMessage(message, type = "info") {
    const el = $("authMessage");
    el.textContent = message;
    el.className = `alert alert-${type} mt-3`;
}

function showToast(message, title = "The Reading Nest") {
    $("toastTitle").textContent = title;
    $("toastMessage").textContent = message;
    bootstrap.Toast.getOrCreateInstance($("appToast"), { delay: 3500 }).show();
}

async function loadFamilyMembers() {
    const container = $("adminMembers");
    container.textContent = "Loading family accounts…";
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("user_id, email, display_name, role, approved, created_at")
        .order("created_at", { ascending: true });

    if (error) {
        container.textContent = "Could not load accounts: " + error.message;
        return;
    }
    if (!data?.length) {
        container.textContent = "No family accounts found yet.";
        return;
    }
    container.innerHTML = data.map(profile => {
        const label = escapeHTML(profile.display_name || profile.email || "Family member");
        const isSelf = profile.user_id === currentUser.id;
        const status = profile.approved ? "Approved" : "Awaiting approval";
        return `<div class="member-row">
            <div><strong>${label}</strong>${isSelf ? ' <span class="badge text-bg-secondary">You</span>' : ""}
            <div class="small text-muted">${escapeHTML(profile.role)} · ${status}</div></div>
            ${profile.role === "member" && !profile.approved
                ? `<button class="btn btn-sm btn-success" type="button" data-approve-user="${escapeAttribute(profile.user_id)}">Approve</button>`
                : ""}
        </div>`;
    }).join("");
    container.querySelectorAll("[data-approve-user]").forEach(button => {
        button.addEventListener("click", () => approveMember(button.dataset.approveUser, button));
    });
}

async function approveMember(memberId, button) {
    button.disabled = true;
    button.textContent = "Approving…";
    const { data, error } = await supabaseClient.rpc("approve_family_member", { member_id: memberId });
    if (error) {
        showToast("Could not approve member: " + error.message, "Approval failed");
        button.disabled = false;
        button.textContent = "Approve";
        return;
    }
    if (!data) {
        showToast("No unapproved member was changed. Refresh the list and check the account.", "No change");
    } else {
        showToast("Family member approved.", "Approval complete");
    }
    await loadFamilyMembers();
}

async function loadBooks() {
    bookList.innerHTML = `<div class="col-12"><div class="empty-library">Loading your family library…</div></div>`;
    const { data, error } = await supabaseClient.from(TABLE_NAME).select("*").order("created_at", { ascending: false });
    if (error) {
        console.error("Could not load books:", error);
        bookList.innerHTML = `<div class="col-12"><div class="alert alert-danger">Could not load books: ${escapeHTML(error.message)}</div></div>`;
        return;
    }
    books = data || [];
    updateFilterOptions();
    displayBooks();
}

function updateFilterOptions() {
    const selectedGenre = genreFilter.value;
    const selectedLanguage = languageFilter.value;
    const genres = [...new Set(books.map(b => b.genre?.trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {sensitivity:"base"}));
    const languages = [...new Set(books.map(b => b.language?.trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {sensitivity:"base"}));
    genreFilter.innerHTML = '<option value="">All Genres</option>';
    languageFilter.innerHTML = '<option value="">All Languages</option>';
    genres.forEach(v => genreFilter.add(new Option(v, v)));
    languages.forEach(v => languageFilter.add(new Option(v, v)));
    genreFilter.value = genres.includes(selectedGenre) ? selectedGenre : "";
    languageFilter.value = languages.includes(selectedLanguage) ? selectedLanguage : "";
}

function displayBooks() {
    const query = searchBox.value.trim().toLocaleLowerCase();
    const genreValue = genreFilter.value;
    const languageValue = languageFilter.value;
    const mode = sortBooks.value;
    const filtered = books.filter(book => {
        const text = [book.title, book.author, book.genre, book.language, book.owner, book.location]
            .filter(Boolean).join(" ").toLocaleLowerCase();
        return text.includes(query) &&
            (!genreValue || normalize(book.genre) === normalize(genreValue)) &&
            (!languageValue || normalize(book.language) === normalize(languageValue));
    });
    filtered.sort((a,b) => {
        if (mode === "name") return (a.title || "").localeCompare(b.title || "", undefined, {sensitivity:"base"});
        if (mode === "author") return (a.author || "").localeCompare(b.author || "", undefined, {sensitivity:"base"}) || (a.title || "").localeCompare(b.title || "", undefined, {sensitivity:"base"});
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    bookCount.textContent = `${filtered.length} ${filtered.length === 1 ? "book" : "books"}`;
    if (!filtered.length) {
        const hasFilters = query || genreValue || languageValue;
        bookList.innerHTML = `<div class="col-12"><div class="empty-library"><h3>📚 ${hasFilters ? "No books found" : "Your family library is ready"}</h3><p>${hasFilters ? "Try changing your search or filters." : "Add your first book to The Reading Nest!"}</p></div></div>`;
        return;
    }
    bookList.innerHTML = filtered.map(book => {
        const cover = book.cover_url
            ? `<img src="${escapeAttribute(book.cover_url)}" class="book-cover" alt="Cover of ${escapeAttribute(book.title || "book")}" loading="lazy">`
            : `<div class="book-cover d-flex align-items-center justify-content-center"><span class="fs-1">📖</span></div>`;
        return `<div class="col-12 col-sm-6 col-md-4 col-lg-3"><div class="card book-card h-100" role="button" tabindex="0" data-book-id="${escapeAttribute(book.id)}">
            ${cover}<div class="card-body"><div class="book-title">${escapeHTML(book.title || "Untitled Book")}</div>
            <div class="book-author mt-1">${escapeHTML(book.author || "Author unknown")}</div>
            ${book.genre ? `<div class="mt-2"><span class="badge text-bg-light">${escapeHTML(book.genre)}</span></div>` : ""}
            ${book.language ? `<div class="small text-muted mt-2">🌐 ${escapeHTML(book.language)}</div>` : ""}
            ${book.owner ? `<div class="small text-muted mt-2">👤 ${escapeHTML(book.owner)}</div>` : ""}
            ${book.location ? `<div class="small text-muted">📍 ${escapeHTML(book.location)}</div>` : ""}
            </div></div></div>`;
    }).join("");
    bookList.querySelectorAll("[data-book-id]").forEach(card => {
        card.addEventListener("click", () => showBookDetails(card.dataset.bookId));
        card.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                showBookDetails(card.dataset.bookId);
            }
        });
    });
}

async function showBookDetails(bookId) {
    const book = books.find(item => item.id === bookId);
    if (!book) return;
    activeBookId = bookId;
    const details = $("bookDetails");
    details.innerHTML = `<div class="text-center mb-3">${book.cover_url ? `<img src="${escapeAttribute(book.cover_url)}" class="details-cover" alt="Book cover">` : '<div class="display-1">📖</div>'}</div>
        <h4 class="details-title">${escapeHTML(book.title || "Untitled Book")}</h4>
        ${detailLine("Author", book.author)}${detailLine("Genre", book.genre)}${detailLine("Language", book.language)}
        ${detailLine("Owner", book.owner)}${detailLine("Location", book.location)}
        <p class="small text-muted">Added ${book.created_at ? escapeHTML(new Date(book.created_at).toLocaleDateString()) : "date unknown"}</p>
        <hr><h5>📚 My reading progress</h5><div class="mb-3"><label class="form-label" for="readingStatus">Status</label>
        <select id="readingStatus" class="form-select"><option value="unread">Unread</option><option value="currently_reading">Currently reading</option><option value="on_hold">On hold</option><option value="finished">Finished</option></select></div>
        <button type="button" class="btn btn-outline-primary btn-sm mb-3" id="saveProgressButton">Save my status</button>
        <hr><h5>🤝 Lending history</h5><div id="loanHistory">Loading lending records…</div>
        <div class="border rounded p-3 mt-3"><h6>Record a loan</h6><div class="mb-2"><label class="form-label" for="borrowerName">Borrower name</label><input id="borrowerName" class="form-control" placeholder="Who borrowed this book?"></div>
        <button type="button" class="btn btn-outline-primary btn-sm" id="recordLoanButton">Record loan</button></div>`;
    $("saveProgressButton").addEventListener("click", () => saveReadingProgress(bookId));
    $("recordLoanButton").addEventListener("click", () => recordLoan(bookId));
    await loadReadingProgress(bookId);
    await loadLoanHistory(bookId);
    bootstrap.Modal.getOrCreateInstance($("bookDetailsModal")).show();
}

function detailLine(label, value) {
    return value ? `<p class="mb-2"><strong>${label}:</strong> ${escapeHTML(value)}</p>` : "";
}

async function loadReadingProgress(bookId) {
    const select = $("readingStatus");
    if (!select) return;
    const { data, error } = await supabaseClient.from("reading_progress")
        .select("status").eq("book_id", bookId).eq("user_id", currentUser.id).maybeSingle();
    if (error) {
        showToast("Could not load reading status: " + error.message, "Reading progress");
        return;
    }
    select.value = data?.status || "unread";
}

async function saveReadingProgress(bookId) {
    const status = $("readingStatus").value;
    const { error } = await supabaseClient.from("reading_progress").upsert({
        user_id: currentUser.id, book_id: bookId, status, updated_at: new Date().toISOString()
    }, { onConflict: "user_id,book_id" });
    if (error) showToast("Could not save reading status: " + error.message, "Save failed");
    else showToast("Your reading status was saved.", "Progress updated");
}

async function loadLoanHistory(bookId) {
    const target = $("loanHistory");
    const { data, error } = await supabaseClient.from("loans")
        .select("id, borrower_name, lent_at, returned_at, created_at")
        .eq("book_id", bookId).order("lent_at", { ascending: false });
    if (error) {
        target.textContent = "Could not load lending history: " + error.message;
        return;
    }
    const loans = data || [];
    if (!loans.length) {
        target.innerHTML = '<p class="text-muted small">No lending history yet.</p>';
        return;
    }
    target.innerHTML = loans.map(loan => `<div class="loan-row">
        <div class="d-flex justify-content-between flex-wrap gap-2"><strong>${escapeHTML(loan.borrower_name)}</strong>
        <span class="status-pill">${loan.returned_at ? "Returned" : "Currently lent out"}</span></div>
        <div class="small text-muted">Lent: ${escapeHTML(formatDate(loan.lent_at))}${loan.returned_at ? ` · Returned: ${escapeHTML(formatDate(loan.returned_at))}` : ""}</div>
        ${!loan.returned_at ? `<button type="button" class="btn btn-sm btn-outline-success mt-2" data-return-loan="${escapeAttribute(loan.id)}">Mark returned today</button>` : ""}
    </div>`).join("");
    target.querySelectorAll("[data-return-loan]").forEach(button => {
        button.addEventListener("click", () => returnLoan(button.dataset.returnLoan, bookId));
    });
}

async function recordLoan(bookId) {
    const borrower = $("borrowerName").value.trim();
    if (!borrower) {
        showToast("Enter the borrower's name first.", "Name required");
        $("borrowerName").focus();
        return;
    }
    const { data: openLoans, error: checkError } = await supabaseClient.from("loans")
        .select("id").eq("book_id", bookId).is("returned_at", null);
    if (checkError) {
        showToast("Could not check loan status: " + checkError.message, "Loan failed");
        return;
    }
    if (openLoans?.length) {
        showToast("This book is already marked as lent out. Mark its current loan returned before recording another.", "Already lent out");
        return;
    }
    const { error } = await supabaseClient.from("loans").insert({
        book_id: bookId, borrower_name: borrower, recorded_by: currentUser.id
    });
    if (error) showToast("Could not record loan: " + error.message, "Loan failed");
    else {
        $("borrowerName").value = "";
        showToast("Loan recorded.", "Book lent out");
        await loadLoanHistory(bookId);
    }
}

async function returnLoan(loanId, bookId) {
    if (!confirm("Mark this book as returned today?")) return;
    const { error } = await supabaseClient.from("loans").update({ returned_at: new Date().toISOString().slice(0,10) }).eq("id", loanId);
    if (error) showToast("Could not update loan: " + error.message, "Return failed");
    else {
        showToast("Return recorded. Lending history was preserved.", "Book returned");
        await loadLoanHistory(bookId);
    }
}

async function previewPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) {
        photoPreview.classList.add("d-none");
        photoPreview.removeAttribute("src");
        return;
    }
    if (!file.type.startsWith("image/")) {
        showToast("Please choose an image file.", "Invalid file");
        event.target.value = "";
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showToast("Please choose an image smaller than 8 MB.", "Image too large");
        event.target.value = "";
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        photoPreview.src = e.target.result;
        photoPreview.classList.remove("d-none");
    };
    reader.readAsDataURL(file);
}

async function saveBook() {
    if (!currentUser || !currentProfile?.approved) {
        showToast("Sign in with an approved family account first.", "Sign-in required");
        return;
    }
    const title = bookTitle.value.trim();
    const author = bookAuthor.value.trim();
    const genre = bookGenre.value;
    const language = bookLanguage.value.trim();
    const owner = bookOwner.value.trim();
    const location = bookLocation.value.trim();
    const photoFile = bookPhoto.files?.[0] || null;
    if (!title) {
        showToast("Please enter a book title.", "Title required");
        bookTitle.focus();
        return;
    }

    const duplicateKey = `${normalize(title)}|${normalize(author)}`;
    const duplicate = books.find(b => b.id !== editingBookId && `${normalize(b.title)}|${normalize(b.author)}` === duplicateKey);
    if (duplicate && pendingDuplicateKey !== duplicateKey) {
        pendingDuplicateKey = duplicateKey;
        $("duplicateWarning").classList.remove("d-none");
        showToast(`A similar book already exists: “${duplicate.title || "Untitled"}”. Click Save Book again if this is intentional.`, "Possible duplicate");
        return;
    }
    pendingDuplicateKey = "";
    $("duplicateWarning").classList.add("d-none");
    saveBookButton.disabled = true;
    const originalButtonText = saveBookButton.textContent;
    saveBookButton.textContent = "Saving…";
    let newlyUploadedPath = null;
    try {
        let coverURL = existingCoverURL;
        if (photoFile) {
            const extension = getFileExtension(photoFile.name);
            const filePath = `${crypto.randomUUID()}.${extension}`;
            const { error: uploadError } = await supabaseClient.storage.from(STORAGE_BUCKET)
                .upload(filePath, photoFile, { cacheControl: "3600", upsert: false });
            if (uploadError) throw uploadError;
            newlyUploadedPath = filePath;
            const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
            coverURL = data.publicUrl;
        }
        const bookData = {
            title, author: author || null, genre: genre || null,
            language: language || null, owner: owner || null,
            location: location || null, cover_url: coverURL || null
        };
        let result;
        if (editingBookId) result = await supabaseClient.from(TABLE_NAME).update(bookData).eq("id", editingBookId).select().single();
        else result = await supabaseClient.from(TABLE_NAME).insert(bookData).select().single();
        if (result.error) throw result.error;

        const wasEditing = Boolean(editingBookId);
        const oldCover = wasEditing ? existingCoverURL : null;
        resetBookForm();
        bootstrap.Modal.getInstance($("addBookModal"))?.hide();
        await loadBooks();
        if (photoFile && oldCover && oldCover !== coverURL) await deleteCoverFromURL(oldCover);
        showToast(wasEditing ? "Book updated successfully." : "Book saved successfully.", "Saved");
    } catch (error) {
        console.error("Could not save book:", error);
        if (newlyUploadedPath) {
            await supabaseClient.storage.from(STORAGE_BUCKET).remove([newlyUploadedPath]).catch(() => {});
        }
        showToast(error.message || "The book could not be saved.", "Save failed");
    } finally {
        saveBookButton.disabled = false;
        saveBookButton.textContent = originalButtonText;
    }
}

function editBook(bookId) {
    const book = books.find(item => item.id === bookId);
    if (!book) return;
    editingBookId = bookId;
    existingCoverURL = book.cover_url || null;
    bookTitle.value = book.title || "";
    bookAuthor.value = book.author || "";
    bookGenre.value = book.genre || "";
    bookLanguage.value = book.language || "";
    bookOwner.value = book.owner || "";
    bookLocation.value = book.location || "";
    if (existingCoverURL) {
        photoPreview.src = existingCoverURL;
        photoPreview.classList.remove("d-none");
    } else {
        photoPreview.classList.add("d-none");
        photoPreview.removeAttribute("src");
    }
    $("bookModalTitle").textContent = "✏️ Edit Book";
    saveBookButton.textContent = "💾 Update Book";
    bootstrap.Modal.getOrCreateInstance($("addBookModal")).show();
}

async function deleteBook(bookId) {
    const book = books.find(item => item.id === bookId);
    if (!book || !confirm(`Are you sure you want to delete "${book.title || "this book"}"? This also removes its cover image if possible, and its linked reading/loan records.`)) return;
    try {
        const { error } = await supabaseClient.from(TABLE_NAME).delete().eq("id", bookId);
        if (error) throw error;
        bootstrap.Modal.getInstance($("bookDetailsModal"))?.hide();
        await loadBooks();
        if (book.cover_url) await deleteCoverFromURL(book.cover_url);
        showToast("Book deleted.", "Deleted");
    } catch (error) {
        console.error("Could not delete book:", error);
        showToast(error.message || "The book could not be deleted.", "Delete failed");
    }
}

async function deleteCoverFromURL(url) {
    try {
        const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
        const index = url.indexOf(marker);
        if (index < 0) return;
        const path = decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
        if (!path) return;
        const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).remove([path]);
        if (error) {
            console.warn("Could not remove cover file:", error.message);
            showToast("The book was saved, but its old cover could not be removed from Storage.", "Storage note");
        }
    } catch (error) {
        console.warn("Cover cleanup failed:", error);
    }
}

function resetBookForm() {
    ["bookTitle", "bookAuthor", "bookLanguage", "bookOwner", "bookLocation"].forEach(id => $(id).value = "");
    bookGenre.value = "";
    bookPhoto.value = "";
    photoPreview.removeAttribute("src");
    photoPreview.classList.add("d-none");
    editingBookId = null;
    existingCoverURL = null;
    pendingDuplicateKey = "";
    $("duplicateWarning").classList.add("d-none");
    $("bookModalTitle").textContent = "📖 Add a Book";
    saveBookButton.textContent = "💾 Save Book";
}

function getFileExtension(fileName) {
    const ext = fileName.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
    return ext || "jpg";
}
function normalize(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function formatDate(value) {
    if (!value) return "Unknown";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
function escapeHTML(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function escapeAttribute(value) { return escapeHTML(value); }

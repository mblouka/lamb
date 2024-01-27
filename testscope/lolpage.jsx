
import currentpages from "./*.md";

export default function PageComponent() {
    return currentpages.map(page => <ul>
        <li>{page.file} - {page.title ?? "no title"}</li>
    </ul>)
}